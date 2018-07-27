var syslog=require('ti.syslog');

syslog.config = { server: 192.168.128.101, port: 12 };
syslog.info('This is a test');

syslog.consoleInject(); // This takes over 'console' object and sends console messages to syslog server
console.log( 'This is a test and will go to syslog server!' );

syslog.consoleRestore();
console.log( 'This will NOT go to syslog server!' );

/* -- real world example -- */

syslog.config = { server: 'listener.logz.io', port: '5000', token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }; // replace with your logz.io setup
syslog.consoleInject();

try {
	// do something scary
} catch( ex ) {
	console.error( ex.getMessage() ); // gets sent up to logz.io with severity "error"
}