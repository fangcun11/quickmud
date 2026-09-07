"""注册 + 进入新手村 + 文件驱动游玩（定时任务用）。
成功进入游戏后常驻：mud_in.txt 每行一条命令，输出全进 mud_log.txt。"""
import socket, time, re, os, sys

HOST, PORT = 'mud.pkuxkx.net', 8081
BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE, 'mud_log.txt')
IN = os.path.join(BASE, 'mud_in.txt')
NAME, PASSWORD, CN_NAME = 'qkfanmud', 'Qk2026mud', '青石散人'

log_f = open(LOG, 'a', encoding='utf-8', errors='replace')
log_f.write(f'
===== tutorial session {time.strftime("%F %T")} =====
')
log_f.flush()
def log(s): log_f.write(s); log_f.flush()

s = socket.create_connection((HOST, PORT), timeout=15)
s.settimeout(0.3)
buf = ''

def pump(sec):
    global buf
    t0 = time.time()
    while time.time() - t0 < sec:
        try:
            d = s.recv(8192)
            if not d:
                log('\n<<CLOSED>>\n'); return False
            t = d.decode('utf-8', errors='replace'); buf += t; log(t)
        except socket.timeout:
            pass
    return True

def send(line):
    log(f'\n>>> {line}\n')
    s.sendall(line.encode('utf-8') + b'\n')

def strip(t):
    return re.sub(r'\x1b\[[0-9;]*m', '', t)

def wait_for(pat, timeout):
    start = len(buf)
    t0 = time.time()
    while time.time() - t0 < timeout:
        pump(0.2)
        if re.search(pat, strip(buf[start:])):
            return True
    return False

# --- 登录/注册（快问快答，总时限约 2 分钟）---
wait_for(r'英文名字', 10); buf = ''
send('new')
if wait_for(r'yes\)', 6): send('yes')
wait_for(r'英文姓?名', 6); buf = ''
send(NAME)
wait_for(r'密码', 6); buf = ''
send(PASSWORD)
wait_for(r'密码|确认', 6); buf = ''
send(PASSWORD)
if wait_for(r'男性\(m\)|女性\(f\)', 6): send('m')
if wait_for(r'中文名', 6): send(CN_NAME)
# 身高（100-220）
if wait_for(r'身高', 6): send('180')
# 剩余确认/继续类提示一律回车
for pat in [r'继续|按回车', r'yes\)']:
    if wait_for(pat, 4): send('')

# --- 检测是否已进入游戏（看到 未名谷/任务提示/> 提示符）---
entered = False
t0 = time.time()
while time.time() - t0 < 20:
    pump(1)
    if '未名谷' in strip(buf) or re.search(r'jq|jobquery|新手', strip(buf)):
        entered = True
        break
    if '太多的新账号' in strip(buf):
        log('\n<<QUOTA BLOCKED>>\n')
        print('QUOTA_BLOCKED'); sys.exit(0)

print('ENTERED' if entered else 'UNCERTAIN')

# --- 文件驱动游玩循环（常驻）---
open(IN, 'w', encoding='utf-8').close()
seen = 0
while True:
    pump(0.8)
    try:
        with open(IN, 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')
    except FileNotFoundError:
        lines = []
    for l in [l for l in lines[seen:] if l.strip() and not l.strip().startswith('#')]:
        try:
            send(l)
            time.sleep(0.6)
            pump(1.2)
        except OSError:
            log('\n<<SEND FAIL>>\n')
    seen = len(lines)
