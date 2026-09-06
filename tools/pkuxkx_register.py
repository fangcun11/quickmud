"""
北侠注册 v3：通用应答循环——按提示模式逐个应答，未知提示继续观察。
全程日志 mud_log.txt。
"""
import socket, time, re, sys

HOST, PORT = 'mud.pkuxkx.net', 8081
LOG = 'mud_log.txt'
NAME, PASSWORD, CN_NAME = 'qkfanmud', 'Qk2026mud', '青石散人'

log_f = open(LOG, 'a', encoding='utf-8', errors='replace')
def log(s):
    log_f.write(s); log_f.flush()

s = socket.create_connection((HOST, PORT), timeout=15)
s.settimeout(1)
buf = ''

def read_for(seconds):
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

RULES = [
    (r'要注册新人物请输入new', 'new'),
    (r'yes\)', 'yes'),
    (r'英文姓?名', NAME),
    (r'非法字符，请重新输入', NAME),
    (r'密码', PASSWORD),
    (r'男性\(m\)|女性\(f\)', 'm'),
    (r'中文名', CN_NAME),
    (r'出生月份|生日', '五月'),
    (r'继续|按回车', ''),
]

read_for(8); send('2'); read_for(4); buf = ''
sent = set()
idle = 0
total = 0
while total < 180:
    seg = strip_ansi(buf)
    matched = False
    for i, (pat, reply) in enumerate(RULES):
        if i in sent:
            continue
        if re.search(pat, seg):
            send(reply if reply else '')
            sent.add(i)
            buf = ''
            read_for(2)
            matched = True
            idle = 0
            break
    if not matched:
        read_for(1)
        idle += 1
        if idle > 20:
            break
    total += 1

print('===== CURRENT TAIL =====')
print(strip_ansi(buf)[-1500:])
