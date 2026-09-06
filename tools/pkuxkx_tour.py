"""单次游览：登录 → 按序列执行命令 → 落盘退出。"""
import socket, time, re, sys

HOST, PORT = 'mud.pkuxkx.net', 8081
NAME, PASSWORD = 'fangcun', 'zm19980127'
CMDS = sys.argv[1:] if len(sys.argv) > 1 else ['look', 'hp']

log_f = open('mud_log.txt', 'a', encoding='utf-8', errors='replace')
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
            if not d: log('\n<<CLOSED>>\n'); return False
            t = d.decode('utf-8', errors='replace'); buf += t; log(t)
        except socket.timeout:
            pass
    return True

def send(l):
    log(f'\n>>> {l}\n'); s.sendall(l.encode('utf-8') + b'\n')

def strip(t): return re.sub(r'\x1b\[[0-9;]*m', '', t)

def wait_for(pat, timeout):
    start = len(buf); t0 = time.time()
    while time.time() - t0 < timeout:
        pump(0.2)
        if re.search(pat, strip(buf[start:])): return True
    return False

t0 = time.time()
wait_for(r'英文名字', 10); buf = ''
send(NAME)
if wait_for(r'yes\)|密码', 6):
    if re.search(r'yes\)', strip(buf)): send('yes')
wait_for(r'密码', 6); buf = ''
send(PASSWORD)
if wait_for(r'\(y/n\)', 5): send('y')
if wait_for(r'SUPPORT|MXP', 6): send('')
pump(3)
# 游玩序列
for cmd in CMDS:
    send(cmd)
    pump(2.5)
pump(3)
print(f'== tour done in {time.time()-t0:.0f}s ==')
print(strip(buf)[-2600:])
