'use strict';

/**
 * Syslog - rfc5424 implementation over TCP (no TLS support yet!)
 * @property Object config { 'server': name/ip to send to, 'port': port on server to send to, 'token': send token (issued by some ELK stacks like logz.io) }
 */

var Syslog = function () {
	this.sock           = null;
	this.sockConnecting = false;
	this.sockConnected  = false;
	this.sockSending    = false;
	this.sendBuffer     = [];

	this.max_length     = 1024; // we'll split messages up that are greater than this length

	this.app_name       = Ti.App.name.replace( /[\s]/g, '_' ); // Application name to show, shouldn't have spaces
	this.hostname       = Ti.Platform.id; // Install or Device ID, closest we can come to a source identifier
	this.facility       = 22; // local6, see list of possible facilities below

	this.config         = {};
	this.config.server  = Ti.App.Properties.getString( 'syslog-host', 'listener.logz.io' );
	this.config.port    = Ti.App.Properties.getString( 'syslog-port', '5000' );
	this.config.token   = undefined; // set this with your logz.io token
};

/**
 * Connect to Syslog server
 * @private
 */
Syslog.prototype._connect = function () {

	if ( this.sockConnecting || this.sockConnected ) {
		return true;
	}

	this.sockConnecting = true;

	this.sock = Ti.Network.Socket.createTCP( {
		'host' : this.config.server,
		'port' : this.config.port
	} );

	this.sock.connected = function ( e ) {

		Ti.API.info( '*** Socket ' + e.type ); // Using this to avoid recursion

		this.sockConnected  = true;
		this.sockConnecting = false;

		if ( this.sendBuffer && this.sendBuffer.length > 0 && !this.sockSending ) {
			this.send();
		}
	};

	this.sock.error = function ( e ) {

		Ti.API.error( '*** Socket Error: ' + JSON.stringify( e ) );

		this.sockConnected  = false;
		this.sockConnecting = false;
	};

	this.sock.connect();
};

/**
 * Sends message queue to syslog server
 * @private
 */
Syslog.prototype._send = function () {

	if ( !this.sockConnecting && !this.sockConnected ) {
		this._connect();
		return;
	}

	if ( this.sockSending ) {
		return;
	}

	this.sockSending = true;

	while ( this.sendBuffer.length > 0 ) {
		var message = this.sendBuffer.shift();

		Ti.Stream.write( this.sock, Ti.createBuffer( {
			'value' : message
		} ), function () {
			// this.sockSending = false;
		} );
	}

	this.sockSending = false;
};

/**
 * Adds message to the message queue
 * @param Ti.Buffer message
 * @private
 */
Syslog.prototype._addMessage = function ( message ) {
	if ( message instanceof Array ) {
		this.sendBuffer = this.sendBuffer.concat( message );
	} else {
		this.sendBuffer.push( message );
	}

	this._send();
};

/**
 * Formats a plain text message to a syslog packet and sends
 * @param message - payload text to send to syslog server
 * @param sev - severity (debug/error/info/warn/notice)
 * @param fac - facility (defaults to local6)
 */
Syslog.prototype.log = function ( message, sev, fac ) {
	/**
	 * Code    Severity
	 0       Emergency: system is unusable
	 1       Alert: action must be taken immediately
	 2       Critical: critical conditions
	 3       Error: error conditions
	 4       Warning: warning conditions
	 5       Notice: normal but significant condition
	 6       Informational: informational messages
	 7       Debug: debug-level messages
	 */

	var severity = sev || 6;

	switch ( sev ) {
		case 'emergency':
		case 'emerg':
			severity = 0;
			break;

		case 'alert':
			severity = 1;
			break;

		case 'critical':
		case 'crit':
		case 'exception':
			severity = 2;
			break;

		case 'error':
		case 'err':
			severity = 3;
			break;

		case 'warning':
		case 'warn':
			severity = 4;
			break;

		case 'notice':
			severity = 5;
			break;

		case 'informational':
		case 'information':
		case 'info':
		case 'debug':
		case 'trace':
		case 'log':
			severity = 6;
			break;

		default:
			severity = 6;
			break;
	}

	/**
	 * Code        Facility
	 0             kernel messages
	 1             user-level messages
	 2             mail system
	 3             system daemons
	 4             security/authorization messages (note 1)
	 5             messages generated internally by syslogd
	 6             line printer subsystem
	 7             network news subsystem
	 8             UUCP subsystem
	 9             clock daemon (note 2)
	 10             security/authorization messages (note 1)
	 11             FTP daemon
	 12             NTP subsystem
	 13             log audit (note 1)
	 14             log alert (note 1)
	 15             clock daemon (note 2)
	 16             local use 0  (local0)
	 17             local use 1  (local1)
	 18             local use 2  (local2)
	 19             local use 3  (local3)
	 20             local use 4  (local4)
	 21             local use 5  (local5)
	 22             local use 6  (local6)
	 23             local use 7  (local7)
	 */

	var facility = fac || this.facility || 22;

	var d = new Date();
	var priority = parseInt((facility * 8) + severity);

	/* Build the header */
	var header     = '<' + priority + '>1 ' + d.toISOString() + ' ' + this.hostname + ' ' + this.app_name + ' - - ';
	if ( this.config.token ) {
		header += '[token@1="' + this.config.token + '"] '
	}
	header += 'BOM';

	/* Now build the message, or multiple messages if this message is too large */
	var remaining = this.max_length - header.length;
	var pos       = 0;
	var messages  = [];

	if ( message.length > remaining ) {
		while ( pos < message.length + 1 ) {
			var newMessage = message.toString().substr( pos, remaining );

			messages.push( header + '' + newMessage );
			pos = pos + remaining;
		}
	} else {
		messages.push( header + message );
	}

	this._addMessage( messages );
};

/**
 * This method makes console.log (and all the others) output to syslog.
 * Undo this with Syslog.consoleRestore().
 */
var consoleMethods = ['debug','error','info','log','warn'];   // https://docs.appcelerator.com/platform/latest/?mobile=/api/Global.console
Syslog.prototype.consoleInject = function () {
	var self = this;
	var handler = function () {
		var sev = arguments.shift();

		Ti.API[sev]( arguments );  // Ti.API.debug( message ) ... to avoid any recursion with console.* methods
		self.log( arguments.join(' '), sev );
	}

	for ( var method in consoleMethods ) {
		console['_old_' + method] = console[method];
		console[method] = handler;
	}
};

/**
 * Restores console to state it was in before
 */
Syslog.prototype.consoleRestore = function () {
	for ( var method in consoleMethods ) {
		console[method] = console['_old_' + method];
		console['_old_' + method] = undefined; // Let it get garbage collected
	}

/* Equivilant to:
	console.debug = console._oldDebug;
	console.error = console._oldError;
	console.info  = console._oldInfo;
	console.log   = console._oldLog;
	console.warn  = console._oldWarn;
 */
};

module.exports = Syslog;