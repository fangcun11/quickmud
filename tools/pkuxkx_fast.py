"""极速注册/登录：不等编码选择，直接快问快答（登录阶段有总时限）。"""
import socket, time, re

HOST, PORT = 'mud.pkuxkx.net', 8081
LOG = 'mud_log.txt'
NAME, PASSWORD, CN_NAME = 'qkfanmud', 'Qk2026mud', '青石散人'

log_f = open(LOG, 'a', encoding='utf-8', errors='replace')
def log(s): log_f.write(s); log_f.flush()

s = socket.create_connection((HOST, PORT), timeout=15)
s.settimeout(0.3)
buf = ''
t_start = time.time()

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

# 连上后直奔名字提示，跳过编码选择
wait_for(r'英文名字', 10)
buf = ''
send('new')
# 须知 yes → 姓名（提示序列紧凑应答）
if wait_for(r'yes\)', 15): send('yes')
wait_for(r'英文姓?名', 10); send(NAME)
wait_for(r'密码', 10); send(PASSWORD)
wait_for(r'密码|确认', 10); send(PASSWORD)
# 性别 → m；中文名 → 青石散人；之后提示尽量答
wait_for(r'男性\(m\)|女性\(f\)|性别', 10); send('m')
wait_for(r'中文名', 8); send(CN_NAME)
# 剩余提示：确认/继续/回车类统一回车，观察 60 秒
for pat in [r'确认', r'继续|按回车']:
    if wait_for(pat, 6): send('')
pump(45)

print('===== TAIL =====')
print(strip_ansi(buf)[-1600:])
