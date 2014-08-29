var API = require('./lib/API');
var http = require('http');
var program = require('commander');
var IPCamera = require('node-ipcamera');
var Events = require('events');

program.option("-u, --url <url>", "Mjpeg stream URL");

program.option("-d, --detectionLevel <level>", "Detection level", parseFloat);

program.option("-p, --storePath <path>", "Store path");

program.option("-s, --detectionFPS <fps>", "Detection fps");

program.option("--thresholdLevel <0..255>", "Image threshold", parseInt);

program.option("--showDeviation", "Log deviation");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL parameter must be specified");
}

if (!program.storePath) {
	throw new Error("StorePath parameter must be specified");
}

var lastJpegEventEmitter = new Events.EventEmitter();

var motionDetect = new API.MotionDetect({
	detectionLevel: program.detectionLevel,
	thresholdLevel: program.thresholdLevel,
	erodeIteration: program.erodeIteration,
	detectionFPS: program.detectionFPS,
	basePath: program.storePath,
	mjpegPrefix: program.mjpegPrefix,
	mjpegSuffix: program.mjpegSuffix,
	showDeviation: program.showDeviation
}, lastJpegEventEmitter);

var request = http.request(program.url, function(response) {

	if (response.statusCode !== 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	var multipartStream = new IPCamera.MultipartMjpegDecoderStream();
	multipartStream.on("jpeg", function(jpeg) {
		lastJpegEventEmitter.emit("jpeg", jpeg);
	});

	response.pipe(multipartStream);
});

request.end();
