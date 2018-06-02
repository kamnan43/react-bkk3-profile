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

const line = new lineSdk.Client(config);
const baseURL = config.BASE_URL;
// app.use(bodyParser.json());
app.use('/static', express.static('static'));
app.use('/downloaded', express.static('downloaded'));
app.post('/git', function (req, res) {
  res.status(200).end();
  git.deploy({
    origin: "origin",
    branch: "master"
  });
});
app.post('/webhooks', lineSdk.middleware(config), (req, res) => {
  // app.post('/webhooks', (req, res) => {
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
        // case 'image':
        //   return downloadProfilePicture(userId, profile.pictureUrl)
        //     .then(() => {
        //       return line.replyMessage(replyToken, [createImageMessage(getProfileUrl(userId), getProfilePreviewUrl(userId))]);
        //     });
        default:
          return line.getProfile(userId)
            .then((profile) => {
              return downloadProfilePicture(userId, profile.pictureUrl)
            })
            .then(() => {
              return line.replyMessage(replyToken, [createImageMessage(getReactUrl(userId), getReactUrl(userId))]);
            });
      }
    case 'follow':
      return line.getProfile(userId)
        .then((profile) => {
          return downloadProfilePicture(userId, profile.pictureUrl)
        }).then(() => {
          return addWaterMask(userId);
        }).then(() => {
          return cp.execSync(`convert -resize 240x ${getProfilePath(userId)} ${getProfilePreviewPath(userId)}`);
        }).then(() => {
          return line.replyMessage(replyToken, [createImageMessage(getReactUrl(userId), getReactUrl(userId))]);
        }).catch((error) => { console.log('updateMemberProfilePicture Error', error + '') })
  }
}

//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////

function getProfilePath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-profile.jpg`);
}

function getReactPath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-react.jpg`);
}

function getProfilePreviewPath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-profile-preview.jpg`);
}

function getreactPreviewPath(userId) {
  return path.join(__dirname, 'downloaded', `${userId}-react-preview.jpg`);
}

function getProfileUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-profile.jpg?date=${Date.now()}`;
}

function getReactUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-react.jpg?date=${Date.now()}`;
}

function getProfilePreviewUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-profile-preview.jpg?date=${Date.now()}`;
}

function getReactPreviewUrl(userId) {
  return config.BASE_URL + `/downloaded/${userId}-react-preview.jpg?date=${Date.now()}`;
}

function downloadProfilePicture(userId, pictureUrl) {
  return new Promise((resolve, reject) => {
    http.get(pictureUrl, function (response) {
      const writable = fs.createWriteStream(getProfilePath(userId));
      response.pipe(writable);
      response.on('end', () => resolve(getProfilePath(userId)));
      response.on('error', reject);
    });
  });
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

function addWaterMask(userId) {
  console.log('addWaterMask');
  return new Promise((resolve, reject) => {
    const mergeImages = require('merge-images');
    const Canvas = require('canvas');

    mergeImages([`downloaded/${userId}-profile.jpg`, 'static/watermask800.png'], {
      Canvas: Canvas
    })
      .then(b64 => {
        console.log('B64');
        var data = b64.replace(/^data:image\/\w+;base64,/, "");
        var buf = new Buffer(data, 'base64');
        fs.writeFile(getReactPath(userId), buf);
        resolve();
      }).catch((error) => {
        console.log('mergeImages Error', error + '');
        reject();
      });
  });
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
