"""Generate only PUBLIC certificate fingerprints, never signing keys."""
import json,re,sys
from pathlib import Path
text=Path(sys.argv[1]).read_text(encoding='utf-8')
match=re.search(r'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})',text)
if not match:raise SystemExit('APK signer certificate fingerprint missing')
raw=match.group(1).upper();fingerprint=':'.join(raw[i:i+2] for i in range(0,64,2))
statement=[{'relation':['delegate_permission/common.handle_all_urls'],'target':{'namespace':'android_app','package_name':'io.limochat.app.browser','sha256_cert_fingerprints':[fingerprint]}}]
Path(sys.argv[2]).write_text(json.dumps(statement,indent=2)+'\n',encoding='utf-8')
