'use strict';

const lineSdk = require('@line/bot-sdk');
const express = require('express');
const fs = require('fs');
const git = require('./git-deploy');
const config = require('./config.json');
const path = require('path');
const cp = require('child_process');
const http = require('http');
const https = require('https');
const app = express();
const sizeOf = require('image-size');

const line = new lineSdk.Client(config);
const baseURL = config.BASE_URL;
app.use('/static', express.static('static'));
app.use('/downloaded', express.static('downloaded'));

//set watermask path
let watermarkImagePath = 'static/watermask.png';
let watermarkFullImagePath = getWaterMaskPath();

//github auto deploy trigger
app.post('/git', function (req, res) {
  res.status(200).end();
  git.deploy({
    origin: "origin",
    branch: "master"
  });
});

//LINE webhooks
app.post('/webhooks', lineSdk.middleware(config), (req, res) => {
  if (!Array.isArray(req.body.events)) {
    return res.status(500).end();
  }
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  console.log(event);
  var userId = event.source.userId;
  //ignore LINE verify button
  if (userId === 'Udeadbeefdeadbeefdeadbeefdeadbeef') {
    return;
  }
  var replyToken = event.replyToken;
  if (!userId) {
    return;
  }
  switch (event.type) {
    case 'message':
      const message = event.message;
      switch (message.type) {
        case 'image':
          return createWaterMaskFromMessage(message.id, replyToken);
          break;
        default:
          return;
        // return createWaterMaskFromProfile(userId, replyToken);
      }
    case 'follow':
    case 'join':
      return createWaterMaskFromProfile(userId, replyToken);
  }
}

//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////

function createWaterMaskFromProfile(userId, replyToken) {
  console.log('createWaterMaskFromProfile');
  return line.getProfile(userId)
    .then((profile) => {
      return downloadProfilePicture(userId, profile.pictureUrl)
    }).then((fileId) => {
      return createWaterMaskThenReply(fileId, replyToken, true);
    });
}

function createWaterMaskFromMessage(messageId, replyToken) {
  console.log('createWaterMaskFromMessage');
  return downloadContent(messageId)
    .then((fileId) => {
      return createWaterMaskThenReply(fileId, replyToken, false);
    });
}

function downloadProfilePicture(userId, pictureUrl) {
  console.log('downloadProfilePicture');
  return new Promise((resolve, reject) => {
    http.get(pictureUrl, function (response) {
      const writable = fs.createWriteStream(getProfilePath(userId));
      response.pipe(writable);
      response.on('end', () => { resolve(userId); });
      response.on('error', reject);
    });
  });
}

function downloadContent(messageId) {
  console.log('downloadContent');
  return line.getMessageContent(messageId)
    .then((stream) => new Promise((resolve, reject) => {
      const writable = fs.createWriteStream(getProfilePath(messageId));
      stream.pipe(writable);
      stream.on('end', () => { resolve(messageId); });
      stream.on('error', reject);
    }));
}

function createWaterMaskThenReply(fileId, replyToken, firstTime) {
  console.log('createWaterMaskThenReply');
  return addWaterMask(fileId)
    .then(() => {
      //create line preview
      cp.execSync(`convert -resize 240x ${getReactPath(fileId)} ${getReactPreviewPath(fileId)}`);
      let ms;
      if (firstTime) {
        ms = [
          createTextMessage('ขอบคุณที่สนใจ\n- นี่คือรูปจากโปรไฟล์ไลน์ของคุณ\n- คุณสามารถใช้รูปอื่นได้ โดยการส่งรูปให้กับบอททางนี้ได้เลย\n- แบ่งปันบอทนี้ให้เพื่อนง่ายๆ แค่แชร์ข้อความข้างล่างนี้ ให้เพื่อนของคุณ'),
          createImageMessage(getReactUrl(fileId), getReactPreviewUrl(fileId)),
          createTextMessage('สร้างรูปโปรไฟล์ React BKK 3.0.0 ง่ายๆ ได้ที่\nhttps://line.me/R/ti/p/1JudgIY9iO'),
        ];
      } else {
        ms = [createImageMessage(getReactUrl(fileId), getReactPreviewUrl(fileId))];
      }
      return line.replyMessage(replyToken, ms);
    }).catch((error) => { console.log('createWaterMaskThenReply Error', error + '') })
}

function addWaterMask(fileId) {
  console.log('addWaterMask');
  return new Promise((resolve, reject) => {
    const mergeImages = require('merge-images');
    const Canvas = require('canvas');
    let sourceImagePath = `downloaded/${fileId}-profile.jpg`;
    let sourceSize = resizeSourceImageIfExceedLINELimit(fileId);
    let waterMaskSize = resizeWaterMaskToMatchSourceImage(sourceSize);

    mergeImages(
      [
        { src: sourceImagePath, x: 0, y: 0 },
        { src: watermarkImagePath, x: (sourceSize.width - waterMaskSize.width) / 2, y: (sourceSize.height - waterMaskSize.height) / 2 },
      ], {
        Canvas: Canvas,
        format: 'image/jpeg',
        quality: 1,
      })
      .then(b64 => {
        var data = b64.replace(/^data:image\/\w+;base64,/, "");
        var buf = new Buffer(data, 'base64');
        fs.writeFile(getReactPath(fileId), buf, () => {
          resolve(fileId);
        });
      }).catch((error) => {
        console.log('mergeImages Error', error + '');
        reject();
      });
  });
}

function resizeSourceImageIfExceedLINELimit(fileId) {
  console.log('resizeSourceImageIfExceedLINELimit');
  let sourceImagePath = `downloaded/${fileId}-profile.jpg`;
  let sourceImageFullPath = getProfilePath(fileId);
  var sourceDimensions = sizeOf(sourceImagePath);
  if (sourceDimensions.width > 1024 || sourceDimensions.height > 1024) {
    if (sourceDimensions.width >= sourceDimensions.height) {
      cp.execSync(`convert -resize 1024x ${sourceImageFullPath} ${sourceImageFullPath}`);
    } else {
      cp.execSync(`convert -resize x1024 ${sourceImageFullPath} ${sourceImageFullPath}`);
    }
    sourceDimensions = sizeOf(sourceImagePath);
  }
  console.log('resizeSourceImageIfExceedLINELimit', sourceDimensions);
  return sourceDimensions;
}

function resizeWaterMaskToMatchSourceImage(sourceDimensions) {
  console.log('resizeWaterMaskToMatchSourceImage');
  if (sourceDimensions.width >= sourceDimensions.height) {
    cp.execSync(`convert -resize x${sourceDimensions.height} ${watermarkFullImagePath} ${watermarkFullImagePath}`);
  } else {
    cp.execSync(`convert -resize ${sourceDimensions.width}x ${watermarkFullImagePath} ${watermarkFullImagePath}`);
  }
  let waterMaskSize = sizeOf(watermarkImagePath);
  console.log('resizeSourceImageIfExceedLINELimit', waterMaskSize);
  return waterMaskSize;
}

//////////////////////////////////////////////////////////////////////
// HELPER FUNCTION //
//////////////////////////////////////////////////////////////////////

function getWaterMaskPath() {
  return path.join(__dirname, 'static', `watermask.png`);
}

function getProfilePath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-profile.jpg`);
}

function getReactPath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-react.jpg`);
}

function getReactPreviewPath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-react-preview.jpg`);
}

function getProfileUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-profile.jpg?date=${Date.now()}`;
}

function getReactUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-react.jpg?date=${Date.now()}`;
}

function getReactPreviewUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-react-preview.jpg?date=${Date.now()}`;
}

function createTextMessage(text) {
  return {
    type: 'text',
    text: text
  };
}

function createImageMessage(originalContentUrl, previewImageUrl) {
  return {
    type: 'image',
    originalContentUrl: originalContentUrl,
    previewImageUrl
  };
}

// listen on port
var certOptions = {
  key: fs.readFileSync('./cert/privkey.pem'),
  cert: fs.readFileSync('./cert/fullchain.pem')
};

app.listen(config.PORT, () => {
  console.log(`listening on ${config.PORT}`);
});
https.createServer(certOptions, app).listen(config.HTTPSPORT);
