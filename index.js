var API = require('./lib/API');
var http = require('http');
var program = require('commander');
var IPCamera = require('node-ipcamera');
var Events = require('events');

program.option("-u, --url <url>", "Mjpeg stream URL");

program.option("--detectionLevel <level>", "Detection level", parseFloat);

program.option("--storePath <path>", "Store path");

program.option("--detectionFPS <fps>", "Set detection fps");

program.option("--thresholdLevel <0..255>", "Set image threshold level", parseInt);

program.option("--showDeviation", "Enable deviation value log");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL parameter must be specified");
}

if (!program.storePath) {
	throw new Error("StorePath parameter must be specified");
}

var lastJpegEventEmitter = new Events.EventEmitter();

var motionDetector = new API.MotionDetector({
	detectionLevel: program.detectionLevel,
	thresholdLevel: program.thresholdLevel,
	erodeIteration: program.erodeIteration,
	detectionFPS: program.detectionFPS,
	basePath: program.storePath,
	mjpegPrefix: program.mjpegPrefix,
	mjpegSuffix: program.mjpegSuffix,
	showDeviation: program.showDeviation
}, lastJpegEventEmitter);

function openConnection() {
	var multipartStream = new IPCamera.MultipartMjpegDecoderStream();

	var request = http.request(program.url, function(response) {

		if (response.statusCode !== 200) {
			throw new Error("Invalid status code of response " + response.statusCode);
		}

		multipartStream.on("jpeg", function(jpeg) {
			lastJpegEventEmitter.emit("jpeg", jpeg);
		});

		response.pipe(multipartStream);

		response.on('end', function(e) {
			console.log("End of request response ! Try to reconnect ...");

			multipartStream.destroy();

			setTimeout(openConnection, 1000 * 10);
		});
	});

	request.on('error', function(e) {
		console.error('Problem with request: ' + e.message);

		multipartStream.destroy();

		if (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED') {
			setTimeout(openConnection, 1000 * 10);
			return;
		}
	});

	request.end();
}

openConnection();
