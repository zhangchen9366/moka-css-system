// 上传健康分种子文件到 COS
const COS = require('cos-js-sdk-v5');
const fs = require('fs');

const creds = JSON.parse(Buffer.from('eyJTZWNyZXRJZCI6IkFLSUR4d3FoV0Z5a0wwYXpRbnl2ZTlIUFhLRzZ4aklldUNKTSIsIlNlY3JldEtleSI6InhpRlpmWURkb3dUenBWMU5WUTlpNEVPYWVUM2F5OTdyIiwiQnVja2V0IjoibW9rYS1jc3Mtc3lzdGVtLTE0Mjg4MzQ2MjciLCJSZWdpb24iOiJhcC1jaGVuZ2R1In0=', 'base64').toString());

const cos = new COS({
    SecretId: creds.SecretId,
    SecretKey: creds.SecretKey,
});

cos.putObject({
    Bucket: creds.Bucket,
    Region: creds.Region,
    Key: 'sync/health-scores.json',
    Body: fs.createReadStream('./seed-health-scores.json'),
}, (err, data) => {
    if (err) {
        console.error('上传失败:', err);
        process.exit(1);
    }
    console.log('上传成功:', data);
});
