"""
北侠注册+游玩一体化驱动：
1) 极速完成注册/登录（账号存在则直接登录）
2) 进入游戏后切换为文件驱动模式：mud_in.txt 每行一条命令，输出全部进 mud_log.txt
"""
import socket, time, re, os

HOST, PORT = 'mud.pkuxkx.net', 8081
BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE, 'mud_log.txt')
IN = os.path.join(BASE, 'mud_in.txt')
NAME, PASSWORD, CN_NAME = 'qkfanmud', 'Qk2026mud', '青石散人'

log_f = open(LOG, 'a', encoding='utf-8', errors='replace')
def log(s): log_f.write(s); log_f.flush()

def connect():
    s = socket.create_connection((HOST, PORT), timeout=15)
    s.settimeout(0.3)
    return s

s = connect()
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

def full_flow():
    """连接 → 登录或注册 → 建角色，直到进游戏"""
    global s, buf
    wait_for(r'英文名字', 10); buf = ''
    send(NAME)
    if wait_for(r'yes\)', 6):
        send('yes')  # 新 ID：玩家须知
    wait_for(r'密码', 10); send(PASSWORD)
    if wait_for(r'密码|确认', 8):
        send(PASSWORD)  # 仅新建时出现
    if wait_for(r'男性\(m\)|女性\(f\)|性别', 12):
        send('m')
    if wait_for(r'中文名', 8):
        send(CN_NAME)
    for pat in [r'yes\)', r'确认|继续|按回车|名字']:
        if wait_for(pat, 5):
            send('' if '回车' in pat or '继续' in pat else '')
    pump(3)

# 若是断线重连（进程内），只登录不重走 new
full_flow()
tail = strip_ansi(buf)
if '已经被注册' in tail or '太多' in tail:
    print('BLOCKED:', tail[-300:]); sys_exit = True
else:
    print('IN FLOW')

# 进入文件驱动模式（游戏中长期驻留）
open(IN, 'w', encoding='utf-8').close()
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
            # 断线重连后重新登录
            try:
                s = connect()
            except Exception:
                time.sleep(5); s = connect()
            buf = ''
            full_flow()
            send(l)
