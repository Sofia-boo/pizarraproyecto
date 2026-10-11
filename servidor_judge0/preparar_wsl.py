"""Configure only the new Ubuntu distribution used to run Judge0."""
import configparser
from pathlib import Path
import shutil

path=Path('/etc/wsl.conf')
config=configparser.ConfigParser()
if path.exists():config.read(path)
changed=False
for section,key,value in [('automount','cgroups','v1'),('boot','systemd','true')]:
    if not config.has_section(section):config.add_section(section)
    if config.get(section,key,fallback='')!=value:
        config.set(section,key,value);changed=True
if changed:
    if path.exists() and not path.with_suffix('.conf.antes-judge0').exists():shutil.copy2(path,path.with_suffix('.conf.antes-judge0'))
    with path.open('w') as file:config.write(file)
print('changed' if changed else 'ready')
