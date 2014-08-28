var IPCamera = require('node-ipcamera');
var http = require('http');

var cv = require('opencv');

console.log(IPCamera);

var multipartStream = new IPCamera.MultipartMjpegDecoderStream();

function processImage(jpeg) {
	console.error("Receive jpeg: ", jpeg);

	cv.ReadImage(jpeg.data, function(err, mat) {
		if (err) {
			console.error(err);
			return;
		}

		mat.convertGrayscale();

		multipartStream.once('jpeg', processImage);
	});
}

multipartStream.once('jpeg', processImage);

var request = http.request("http://delabarre3.oeuillot.net:8089/mjpeg", function(response) {

	if (response.statusCode != 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	response.pipe(multipartStream);
});

request.end();
