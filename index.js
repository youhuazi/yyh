// dependencies
// 画像のサムネイル画像を作成するためのsharpモジュール参考サイト：https://sharp.pixelplumbing.com/
// 動画のサムネイル画像を作成するためのソフトウェアffmpegの参考サイト：https://www.ffmpeg.org/
var async = require('async');
var AWS = require('aws-sdk');
var util = require('util');
var sharp = require('sharp');
var fs = require('fs');
var execSync = require('child_process').execSync;
process.env.PATH += ':/var/task/bin';

// get reference to S3 client
var s3 = new AWS.S3();

exports.handler = function (event, context, callback) {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    var srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    var fullFilename = srcKey.split('/')[srcKey.split('/').length - 1];
    var extension = fullFilename.split('.')[fullFilename.split('.').length - 1];
    var dstBucket = srcBucket + "-resized";
    var dstKey = srcKey;

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
            // Transform the video to image
            if (imageType == "mp4" || imageType == "m4v") {
                console.log("create video screenshot start:");
                fs.writeFileSync('/tmp/video.' + imageType, response.Body);
                execSync('ffmpeg -i /tmp/video.' + imageType + " -ss 00:00:01 -vframes 1 /tmp/screenShot.jpg");

                var resultFile = fs.createReadStream('/tmp/screenShot.jpg');
                console.log("create screenshotImage successfully");
                dstKey = dstKey.substr(0, (dstKey.length - extension.length)) + 'jpg';
                console.log(dstKey);
                next(null, "image/jpg", resultFile);
            } else if (imageType == 'gif') {

                // Transform the gif buffer in memory.
                dstKey = dstKey.substr(0, (dstKey.length - extension.length)) + 'jpg';
                sharp(response.Body)
                    .resize({
                        width: 150,
                        height: 150,
                        fit: sharp.fit.inside
                    })
                    .toBuffer('jpg', function (err, buffer) {
                        if (err) {
                            next(err);
                        } else {
                            next(null, 'image/jpg', buffer);
                        }
                    });
            } else {
                // Transform the image buffer in memory.
                sharp(response.Body)
                    .resize({
                        width: 150,
                        height: 150,
                        fit: sharp.fit.inside
                    })
                    .toBuffer(imageType, function (err, buffer) {
                        if (err) {
                            next(err);
                        } else {
                            next(null, response.ContentType, buffer);
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
                next(null, 'upload finished'));
        },
        function deleteFile(data, next) {
            if (imageType == "mp4" || imageType == "m4v") {
                try {
                    //deleted provisional video
                    fs.unlinkSync('/tmp/video.' + imageType);
                    //deleted provisional image
                    fs.unlinkSync('/tmp/screenShot.jpg');
                    console.log('file deleted');
                    next(null, 'deleted fill');
                } catch (err) {
                    next(err);
                }
            }

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
