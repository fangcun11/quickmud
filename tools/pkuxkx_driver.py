"""北侠健壮驱动：自动重连 + 登录 + 文件驱动游玩（mud_in.txt 每行一条命令）。"""
import socket, time, re, os, sys

HOST, PORT = 'mud.pkuxkx.net', 8081
BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE, 'mud_log.txt')
IN = os.path.join(BASE, 'mud_in.txt')
NAME, PASSWORD = 'fangcun', 'zm19980127'

log_f = open(LOG, 'a', encoding='utf-8', errors='replace')
def log(s): log_f.write(s); log_f.flush()

s = None
buf = ''
alive = False

def connect():
    global s, buf, alive
    s = socket.create_connection((HOST, PORT), timeout=15)
    s.settimeout(0.3)
    buf = ''
    alive = True
    log('\n===== connected =====\n')

def pump(seconds):
    global alive, buf
    t0 = time.time()
    while time.time() - t0 < seconds:
        if not alive:
            return
        try:
            d = s.recv(8192)
            if not d:
                log('\n<<CLOSED>>'); alive = False; return
            log(d.decode('utf-8', errors='replace')); buf += d.decode('utf-8', errors='replace')
        except socket.timeout:
            pass
        except OSError:
            log('\n<<ABORTED>>'); alive = False; return

def send(line):
    global alive
    try:
        s.sendall(line.encode('utf-8') + b'\n')
        log(f'\n>>> {line}\n')
    except OSError:
        alive = False

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

def login():
    """登录并处理踢人/须知/回车类提示"""
    global buf
    wait_for(r'英文名字', 12); buf = ''
    send(NAME)
    if wait_for(r'yes\)|密码', 12):
        if re.search(r'yes\)', strip_ansi(buf)): send('yes')
    wait_for(r'密码', 12); buf = ''
    send(PASSWORD)
    if wait_for(r'\(y/n\)', 10):
        send('y')
    # MXP 检测 5 秒窗口：立刻回车进普通模式（拖过窗口会被静默断连）
    wait_for(r'MXP|SUPPORT', 8)
    send('')
    pump(3)
    send('')
    pump(3)

open(IN, 'w', encoding='utf-8').close()
seen = 0
connect()
login()

while True:
    pump(0.8)
    if not alive:
        try:
            connect(); login()
        except Exception as e:
            log(f'<<RECONNECT FAIL {e}>>'); time.sleep(8)
        continue
    try:
        with open(IN, 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')
    except FileNotFoundError:
        lines = []
    new = [l for l in lines[seen:] if l.strip() and not l.strip().startswith('#')]
    seen = len(lines)
    for l in new:
        if not alive:
            connect(); login()
        send(l)
        time.sleep(0.8)
        pump(1.2)
