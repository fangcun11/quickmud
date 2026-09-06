"""登录用户提供的账号 fangcun，进游戏后切换文件驱动模式长期驻留。"""
import socket, time, re, os, sys

HOST, PORT = 'mud.pkuxkx.net', 8081
BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE, 'mud_log.txt')
IN = os.path.join(BASE, 'mud_in.txt')
NAME, PASSWORD = 'fangcun', 'zm19980127'

log_f = open(LOG, 'a', encoding='utf-8', errors='replace')
def log(s): log_f.write(s); log_f.flush()

s = socket.create_connection((HOST, PORT), timeout=15)
s.settimeout(0.3)
buf = ''
def pump(seconds):
    global buf
    t0 = time.time()
    while time.time() - t0 < seconds:
        try:
            d = s.recv(8192)
            if not d:
                log('\n<<CLOSED>>'); return False
            t = d.decode('utf-8', errors='replace'); buf += t; log(t)
        except socket.timeout:
            pass
        except OSError:
            log('\n<<ABORTED>>'); return False
    return True

def send(line):
    log(f'\n>>> {line}\n')
    s.sendall(line.encode('utf-8') + b'\n')

def strip_ansi(t):
    return re.sub(r'\x1b\[[0-9;]*m', '', t)

def wait_for(pattern, timeout):
    start = len(buf)
    t0 = time.time()
    while time.time() - t0 < timeout:
        pump(0.3)
        if re.search(pattern, strip_ansi(buf[start:])):
            return True
    return False

# 登录：英文名 → 密码（中间若弹须知 yes 就答）
wait_for(r'英文名字', 10); buf = ''
send(NAME)
if wait_for(r'yes\)', 6): send('yes')
wait_for(r'密码', 10); send(PASSWORD)
# 后续提示（欢迎/公告/确认）统一快速处理
for pat, rep in [(r'继续|按回车|确认', ''), (r'yes\)', 'yes')]:
    if wait_for(pat, 5): send(rep)
pump(8)
open(IN, 'w', encoding='utf-8').close()

# 文件驱动驻留：mud_in.txt 每行一条命令
seen = 0
while True:
    pump(1)
    try:
        with open(IN, 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')
    except FileNotFoundError:
        lines = []
    new = [l for l in lines[seen:] if l.strip() and not l.strip().startswith('#')]
    seen = len(lines)
    for l in new:
        try:
            send(l)
        except OSError:
            # 断线重连
            try:
                s.close()
            except Exception:
                pass
            time.sleep(3)
            try:
                s = socket.create_connection((HOST, PORT), timeout=15)
                s.settimeout(0.3)
                buf = ''
                wait_for(r'英文名字', 10); buf = ''
                send(NAME)
                if wait_for(r'yes\)', 6): send('yes')
                wait_for(r'密码', 10); send(PASSWORD)
                pump(5)
                send(l)
            except Exception as e:
                log(f'\n<<RECONNECT FAIL: {e}>>')
