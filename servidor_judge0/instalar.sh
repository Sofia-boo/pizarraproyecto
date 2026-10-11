#!/usr/bin/env bash
set -euo pipefail
# Judge0's supported deployment requires Linux and cgroup v1.
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  echo 'Judge0 1.13.1 requiere cgroup v1. Configurar Linux con systemd.unified_cgroup_hierarchy=0 y reiniciarlo antes de continuar.' >&2
  exit 1
fi
if [ ! -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
  echo 'Falta el controlador de memoria cgroup v1. Se requiere un nucleo Linux compatible; WSL 6.18 no lo incluye.' >&2
  exit 1
fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose curl unzip python3
if command -v systemctl >/dev/null && systemctl is-system-running >/dev/null 2>&1; then
  systemctl enable --now docker
else
  service docker start
fi
install -d -m 700 /opt/pizarra-judge0
cd /opt/pizarra-judge0
if [ ! -f docker-compose.yml ]; then
  curl --fail --location --proto '=https' --tlsv1.2 https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip -o release.zip
  unzip -q release.zip
  cp judge0-v1.13.1/docker-compose.yml judge0-v1.13.1/judge0.conf .
  python3 - <<'PY'
from pathlib import Path
import secrets,re
config=Path('judge0.conf')
s=config.read_text()
for key in ('REDIS_PASSWORD','POSTGRES_PASSWORD'):
    s=re.sub(r'^'+key+r'=.*$',key+'='+secrets.token_hex(32),s,flags=re.M)
for key,value in {'ALLOW_ENABLE_NETWORK':'false','ENABLE_NETWORK':'false','ALLOW_IP':'','ALLOW_ORIGIN':'','ENABLE_TELEMETRY':'false','COUNT':'1'}.items():
    if re.search(r'^'+key+r'=',s,re.M):s=re.sub(r'^'+key+r'=.*$',key+'='+value,s,flags=re.M)
config.write_text(s)
config.chmod(0o600)
compose=Path('docker-compose.yml')
text=compose.read_text().replace('2358:2358','127.0.0.1:2358:2358')
compose.write_text(text)
PY
fi
# The image runs as judge0 (uid 1000, gid 999), not root. Keep the
# configuration private while allowing that user to read the bind mount.
chown 1000:999 judge0.conf
chmod 600 judge0.conf
docker-compose up -d db redis
sleep 10
docker-compose up -d
python3 - <<'PY'
import json,time,urllib.request
base='http://127.0.0.1:2358'
for attempt in range(90):
    try:
        urllib.request.urlopen(base+'/languages',timeout=3);break
    except OSError: time.sleep(2)
else:raise SystemExit('Judge0 no inicia.')
def run(source,expected):
    body=json.dumps({'source_code':source,'language_id':54,'cpu_time_limit':1,'wall_time_limit':3,'enable_network':False}).encode()
    token=json.load(urllib.request.urlopen(urllib.request.Request(base+'/submissions?wait=false',data=body,headers={'Content-Type':'application/json'}),timeout=10))['token']
    for i in range(60):
        data=json.load(urllib.request.urlopen(base+'/submissions/'+token,timeout=5))
        if data['status']['id']>2:break
        time.sleep(1)
    if data['status']['id']!=expected:raise SystemExit('Fallo prueba Judge0: '+str(data))
    return data
ok=run('#include <iostream>\nint main(){std::cout << "pizarra-ok";}',3)
assert ok['stdout']=='pizarra-ok'
run('int main(){while(true){}}',5)
print('Judge0: compilacion y limite de tiempo verificados.')
PY
