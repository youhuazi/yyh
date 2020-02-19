// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var util = require('util');
var sharp = require('sharp');
var fs = require('fs');
var execSync = require('child_process').execSync;
process.env.PATH += ':/var/task/bin';

// get reference to S3 client
var s3 = new AWS.S3();

exports.handler = function(event, context, callback) {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    var srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey    = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    console.log('srckey:' + srcKey);
    var fullFilename = srcKey.split('/')[srcKey.split('/').length - 1];
    var extension = srcKey.split('/')[srcKey.split('/').length - 1].split('.')[1];
    var	filename  = srcKey.split('/')[srcKey.split('/').length - 1].split('.')[0];
    var dstBucket = srcBucket + "-resized";
    var dstKey    = srcKey;

    // Sanity check: validate that source and destination are different buckets.
    if (srcBucket == dstBucket) {
        callback("Source and destination buckets are the same.");
        return;
    }

    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        callback("Could not determine the image type.");
        return;
    }
    var imageType = typeMatch[1].toLowerCase();
    if (imageType != "jpg" && imageType != "png" && imageType != "jpeg" && imageType != "gif" && imageType != "mp4" && imageType != "m4v") {
        callback(`Unsupported image type: ${imageType}`);
        return;
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
            // Download the image from S3 into a buffer.
            s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                },
                next);
            },
        function transform(response, next) {
            // set thumbnail width. Resize will set height automatically 
            // to maintain aspect ratio.
	    // Transform the video to image
	    if(imageType == "mp4" || imageType == "m4v" ){
                console.log("create video screenshot start:");
	        fs.writeFileSync('/tmp/' + filename + '.' + extension, response.Body);
	        execSync('ffmpeg -i /tmp/' + filename + '.' + extension +' -ss 00:00:01 -vframes 1 /tmp/' + filename +'.jpg');
	       
                var resultFile = fs.createReadStream('/tmp/' + filename + '.jpg');
                console.log("create screenshotImage successfully");
                dstKey = dstKey.replace(fullFilename, filename + '.jpg');
                console.log(dstKey)
                next(null, "image/jpg",resultFile);
            } else {
	    
            // Transform the image buffer in memory.
		if (imageType == 'gif') {
		    dstKey = dstKey.replace(fullFilename, filename + '.jpg');
		}
                sharp(response.Body)
                   .resize({
		       width: 150,
		       height: 150,
		       fit: sharp.fit.inside
		   })
                       .toBuffer((imageType != 'gif' ? imageType : 'image/jpg'), function(err, buffer) {
                            if (err) {
                                next(err);
                            } else {
                                next(null, (imageType != 'gif' ? response.ContentType : 'image/jpg'), buffer);
                            }
                        });
      		 }
        },

        function upload(contentType, data, next) {
            // Stream the transformed image to a different S3 bucket.
            s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: contentType
                },
                next);
            }
        ], function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + dstKey
                );
            }

            callback(null, "message");
        }
    );
};
