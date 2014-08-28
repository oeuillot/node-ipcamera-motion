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

function processImage(jpeg) {
	console.error("Receive jpeg: ", jpeg);

	cv.readImage(jpeg.data, function(err, mat) {
		if (err) {
			console.error(err);
			return;
		}

		mat.convertGrayscale();

		mat.saveAsync('/temp/img' + (cnt++) + '.jpg', function(error) {
			if (error) {
				console.error(error);
			}

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
