/**
 * Automatic Image resize, reduce with AWS Lambda
 * Lambda main handler
 *
 * @author Yoshiaki Sugimoto
 * @created 2015/10/29
 */
"use strict";

const ImageProcessor = require("./lib/ImageProcessor");
const S3FileSystem   = require("./lib/S3FileSystem");
const eventParser    = require("./lib/EventParser");
const Config         = require("./lib/Config");
const fs             = require("fs");
const path           = require("path");
const aws            = require("aws-sdk");
const crypto         = require("crypto");

// Lambda Handler
exports.handler = (event, context, callback) => {

    var eventRecord = eventParser(event);
    if (eventRecord) {
        process(eventRecord, callback);
    } else {
        console.log(JSON.stringify(event));
        callback('Unsupported or invalid event');
        return;
    }
};

function process(s3Object, callback) {
    const configPath = path.resolve(__dirname, "config.json");
    const fileSystem = new S3FileSystem();
    const processor  = new ImageProcessor(fileSystem, s3Object);
    const config     = new Config(
        JSON.parse(fs.readFileSync(configPath, { encoding: "utf8" }))
    );

    const name = s3Object.object.key.toLowerCase();
    if (name.endsWith('.mp4') || name.endsWith('.mov')) {
        processVideo(fileSystem, config.stack, s3Object, callback);
        return;
    }

    processor.run(config)
    .then((processedImages) => {
        const message = "OK, " + processedImages + " images were processed.";
        console.log(message);
        callback(null, message);
        return;
    })
    .catch((messages) => {
        if ( messages === "Object was already processed." ) {
            console.log("Image already processed");
            callback(null, "Image already processed");
            return;
        } else if ( messages === "Empty file or directory." ) {
            console.log( "Image file is broken or it's a folder" );
            callback( null, "Image file is broken or it's a folder" );
            return;
        } else {
            console.log('err', messages, messages.stack)
            callback("Error processing " + s3Object.object.key + ": " + messages);
            return;
        }
    });
}

// TODO: can have multiple items?
function processVideo(fileSystem, config, s3Object, callback) {
    let mediaconv = new aws.MediaConvert();
    mediaconv.endpoint = 'https://qzovegirb.mediaconvert.ap-northeast-2.amazonaws.com';

    let client = fileSystem.client;
    let uuid = crypto.randomBytes(16).toString('hex');
    let dir = config.backup.directory;
    let srcext = s3Object.object.key.split('.').pop();
    let video = {
        CopySource: '/' + s3Object.bucket.name + '/' + s3Object.object.key,
        Bucket: config.bucket,
        Key: dir + uuid + '.' + srcext,
    };

    console.log('Processing video', video);
    
    // I don't know how to use promises

    // TODO error handling
    client.copyObject(video, (err, res) => { 
        if (err == null) {
            console.log('Copied video to target');
            client.deleteObject({
                Bucket: s3Object.bucket.name,
                Key: s3Object.object.key
            }, (err, res) => { if (err) console.log(err) })

            // - process the video
            mediaconv.createJob({
                JobTemplate: 'life-previews', 
                Role: 'arn:aws:iam::500390570874:role/life-mediaconvert',
                Settings: {
                    Inputs: [{FileInput: 's3://' + video.Bucket + '/' + video.Key}],
                    OutputGroups: [{
                        OutputGroupSettings: {FileGroupSettings: {
                            Destination: "s3://life.rplasil.name/" + dir + 'p500-' + uuid}}}]
                }
            }, (err, res) => console.log('mediaconvert create job', err));
        }

        callback(err, 'done ish') 
    });
    

    let cfgres = config.resizes[0];
}
