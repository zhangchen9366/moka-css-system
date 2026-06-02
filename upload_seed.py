#!/usr/bin/env python3
"""Upload seed health-scores.json to COS using REST API"""
import json, hmac, hashlib, time, urllib.request, urllib.error
from base64 import b64decode

# Decode credentials
creds_enc = "eyJTZWNyZXRJZCI6IkFLSUR4d3FoV0Z5a0wwYXpRbnl2ZTlIUFhLRzZ4aklldUNKTSIsIlNlY3JldEtleSI6InhpRlpmWURkb3dUenBWMU5WUTlpNEVPYWVUM2F5OTdyIiwiQnVja2V0IjoibW9rYS1jc3Mtc3lzdGVtLTE0Mjg4MzQ2MjciLCJSZWdpb24iOiJhcC1jaGVuZ2R1In0="
creds = json.loads(b64decode(creds_enc).decode())
secret_id = creds["SecretId"]
secret_key = creds["SecretKey"]
bucket = creds["Bucket"]
region = creds["Region"]
obj_key = "sync/health-scores.json"

# Prepare request
body = b'{"snapshots":[]}'
host = f"{bucket}.cos.{region}.myqcloud.com"
url = f"https://{host}/{obj_key}"

# Generate signature
now = int(time.time())
sign_time = f"{now - 60};{now + 3600}"
key_time = sign_time

# Step 1: SignKey
sign_key = hmac.new(secret_key.encode(), key_time.encode(), hashlib.sha1).hexdigest()

# Step 2: HttpString
http_method = "put"
uri_path = "/" + obj_key
http_headers = f"content-length={len(body)}&host={host}"
http_string = f"{http_method}\n{uri_path}\n\n{http_headers}\n"

# Step 3: StringToSign
http_string_sha1 = hashlib.sha1(http_string.encode()).hexdigest()
string_to_sign = f"sha1\n{sign_time}\n{http_string_sha1}\n"

# Step 4: Signature
signature = hmac.new(sign_key.encode(), string_to_sign.encode(), hashlib.sha1).hexdigest()

# Authorization header
auth = (
    f"q-sign-algorithm=sha1"
    f"&q-ak={secret_id}"
    f"&q-sign-time={sign_time}"
    f"&q-key-time={key_time}"
    f"&q-header-list=content-length;host"
    f"&q-url-param-list="
    f"&q-signature={signature}"
)

headers = {
    "Host": host,
    "Content-Length": str(len(body)),
    "Authorization": auth,
    "Content-Type": "application/json",
}

req = urllib.request.Request(url, data=body, headers=headers, method="PUT")
try:
    resp = urllib.request.urlopen(req, timeout=15)
    print(f"Upload OK: {resp.status}")
    print(resp.read().decode()[:200] if resp.status == 200 else "")
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(e.read().decode())
except Exception as e:
    print(f"Error: {e}")
