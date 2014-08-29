var IPCamera = require('node-ipcamera');
var http = require('http');
var cv = require('opencv');
var program = require('commander');
var fs = require('fs');
var path = require('path');

program.option("-u, --url <url>", "Mjpeg stream URL");

program.option("-d, --detectionLevel <level>", "Detection level", parseFloat);

program.option("-p, --storePath <path>", "Store path");

program.option("-s, --detectionFPS <fps>", "Detection fps");

program.option("--thresholdLevel <0..255>", "Image threshold", parseInt);

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL parameter must be specified");
}

if (!program.storePath) {
	throw new Error("StorePath parameter must be specified");
}

var multipartStream = new IPCamera.MultipartMjpegDecoderStream();

var stddevLevel = program.detectionLevel || 5;
var thresholdLevel = program.thresholdLevl || 35;
var erodeIteration = 2;

var prevFrame;
var currentFrame;
var nextFrame;

var firstImageDate = 0;
var imageIndex = 0;
var imageDelayMs = Math.floor(1000 / (program.detectionFPS || 25));

var d1 = new cv.Matrix();
var d2 = new cv.Matrix();
var motion = new cv.Matrix();

var frames = [];
var recordTo = 0;
var recordStream = 0;
var maxImages = 0;

function createPath(basePath, date, prefix, suffix) {
	var mn = date.getMonth() + 1;
	var md = date.getDate();
	var mh = date.getHours();
	var mi = date.getMinutes();
	var ms = date.getSeconds();

	var p = path.join(basePath, String(date.getFullYear()));
	try {
		fs.statSync(p);
	} catch (x) {
		if (x.code === 'ENOENT') {
			fs.mkdirSync(p);
		} else {
			console.log(x);
			throw x;
		}
	}

	p = path.join(p, ((mn < 10) ? "0" : "") + mn);
	try {
		fs.statSync(p);
	} catch (x) {
		if (x.code === 'ENOENT') {
			fs.mkdirSync(p);
		} else {
			console.log(x);
			throw x;
		}
	}

	p = path.join(p, ((md < 10) ? "0" : "") + md);
	try {
		fs.statSync(p);
	} catch (x) {
		if (x.code === 'ENOENT') {
			fs.mkdirSync(p);
		} else {
			console.log(x);
			throw x;
		}
	}

	if (false) {
		p = path.join(p, ((mh < 10) ? "0" : "") + mh);
		try {
			fs.statSync(p);
		} catch (x) {
			if (x.code === 'ENOENT') {
				fs.mkdirSync(p);
			} else {
				console.log(x);
				throw x;
			}
		}
	}

	p = path.join(p, prefix + date.getFullYear() + "-" + ((mn < 10) ? "0" : "") + mn + "-" + ((md < 10) ? "0" : "") + md +
			" " + ((mh < 10) ? "0" : "") + mh + "-" + ((mi < 10) ? "0" : "") + mi + "-" + ((ms < 10) ? "0" : "") + ms +
			suffix);

	return p;
}

function processImage(jpeg) {

	var now = Date.now();

	if (recordStream && recordTo + 500 >= now) {
		recordStream.pushJpeg(jpeg);

	} else {
		recordTo = 0;

		for (; frames.length;) {
			if (frames[0].date.getTime() > now - 2000) {
				break;
			}

			if (recordStream) {
				console.error("Close stream");
				recordStream.close();
				recordStream = null;
			}

			frames.shift();
		}

		frames.push(jpeg);
	}

	if (frames.length > maxImages) {
		maxImages = frames.length;
		console.error(maxImages + " images in memory");
	}

	if (firstImageDate + imageIndex * imageDelayMs > now) {
		imageIndex++;
		console.error("Skip frame");

		multipartStream.once('jpeg', processImage);
		return;
	}
	imageIndex++;
	console.error("Process frame");

	cv.readImage(jpeg.data, function(err, mat) {
		if (err) {
			console.error(err);
			return;
		}

		mat.convertGrayscale();

		prevFrame = currentFrame;
		currentFrame = nextFrame;
		nextFrame = mat;

		if (!prevFrame || !currentFrame || !nextFrame) {
			multipartStream.once('jpeg', processImage);
			return;
		}

		d1.absDiff(prevFrame, nextFrame);
		d2.absDiff(nextFrame, currentFrame);
		motion.bitwiseAnd(d1, d2);
		motion.threshold(thresholdLevel, 255);
		motion.erode(erodeIteration);

		var dev = motion.meanStdDev();
		var stddev = dev.stddev.get(0, 0);
		// console.error("Deviation=", stddev);
		if (stddev < stddevLevel) {
			multipartStream.once('jpeg', processImage);
			return;
		}

		recordTo = now + 2500;

		if (recordStream) {
			for (; frames.length;) {
				recordStream.pushJpeg(frames.shift());
			}

			multipartStream.once('jpeg', processImage);
			return;
		}

		var p = createPath(program.storePath, jpeg.date, "Movie ", ".mjpeg");

		var fsStream = fs.createWriteStream(p);
		recordStream = new IPCamera.MultipartMjpegEncoderStream({}, fsStream);

		for (; frames.length;) {
			recordStream.pushJpeg(frames.shift());
		}

		multipartStream.once('jpeg', processImage);
	});
}

multipartStream.once('jpeg', processImage);

var request = http.request(program.url, function(response) {

	if (response.statusCode !== 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	firstImageDate = Date.now();
	response.pipe(multipartStream);
});

request.end();
