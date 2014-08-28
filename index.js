var IPCamera = require('node-ipcamera');
var http = require('http');
var cv = require('opencv');
var program = require('commander');

program.option("-u, --url <url>", "Mjpeg stream URL");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL must be specified");
}

var multipartStream = new IPCamera.MultipartMjpegDecoderStream();

var cnt = 0;

var prevFrame;
var currentFrame;
var nextFrame;

var d1=new cv.Matrix();
var d2=new cv.Matrix();
var motion=new cv.Matrix();

function processImage(jpeg) {
	console.error("Receive jpeg: ", jpeg);

	cv.readImage(jpeg.data, function(err, mat) {
		console.error("Read image: ", err, mat);
		if (err) {
			console.error(err);
			return;
		}
		
		mat.convertGrayscale();

		prevFrame=currentFrame;
		currentFrame=nextFrame;
		nextFrame=mat;
		
		if (!prevFrame || !currentFrame || !nextFrame) {
			multipartStream.once('jpeg', processImage);
			return;
		}
		
		d1.absDiff(prevFrame, nextFrame);
		d2.absDiff(nextFrame, currentFrame);
		motion.bitwiseAnd(d1, d2);
		motion.threshold(35, 255);
		motion.erode(1);

		//var nc=motion.detectMotion()
		
		console.error("Saving ...");

		motion.saveAsync('/tmp/img' + (cnt++) + '.jpg', function(error) {
			if (error) {
				console.error(error);
			}

			console.error("Motion saved");
			multipartStream.once('jpeg', processImage);
		
		});
	});
}

multipartStream.once('jpeg', processImage);

var request = http.request(program.url, function(response) {

	if (response.statusCode != 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	response.pipe(multipartStream);
});

request.end();
