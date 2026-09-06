"""
北侠（pkuxkx）文件驱动 telnet 客户端 —— 观摩用
连接 mud.pkuxkx.net:8081（UTF-8）。
- 输出（含 ANSI 颜色码）追加写入 mud_log.txt
- 每秒检查 mud_in.txt：有新行（非空、非 # 注释）就作为一行命令发送
用法：python pkuxkx_client.py  （后台常驻）
"""
import socket, time, os, sys

HOST, PORT = 'mud.pkuxkx.net', 8081
BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE, 'mud_log.txt')
IN = os.path.join(BASE, 'mud_in.txt')

# 起始状态：清空输入文件，日志标记新会话
open(IN, 'w', encoding='utf-8').close()
with open(LOG, 'a', encoding='utf-8') as f:
    f.write(f'\n===== session start {time.strftime("%F %T")} =====\n')

s = socket.create_connection((HOST, PORT), timeout=15)
s.settimeout(1)
# 告知服务器选 UTF-8（提示说 Input 2 for UTF8）
s.sendall(b'2\n')

in_read_pos = 0
def poll_input():
    global in_read_pos
    try:
        with open(IN, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        return
    lines = content.split('\n')
    # 只发送未消费过的行（按字节偏移简化：读过的行数记录在游标）
    new_lines = [l for l in lines[in_read_pos:] if l.strip() and not l.strip().startswith('#')]
    consumed = len(lines) - (len(lines) - len(lines))  # placeholder
    # 计算已消费行数：游标前进到最后一行（含空行都算已见）
    prev = getattr(poll_input, 'seen', 0)
    all_lines = lines
    new_lines = [l for l in all_lines[prev:] if l.strip() and not l.strip().startswith('#')]
    poll_input.seen = len(all_lines)
    for l in new_lines:
        s.sendall(l.encode('utf-8') + b'\n')
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(f'\n>>> {l}\n')

poll_input.seen = 0
while True:
    try:
        data = s.recv(8192)
        if not data:
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write('\n===== closed by server =====\n')
            break
        with open(LOG, 'a', encoding='utf-8', errors='replace') as f:
            f.write(data.decode('utf-8', errors='replace'))
    except socket.timeout:
        pass
    except OSError as e:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(f'\n===== error: {e} =====\n')
        break
    poll_input()
