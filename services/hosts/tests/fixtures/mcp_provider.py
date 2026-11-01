"""Local stdio MCP fixture, no network or third-party packages."""
import json
import os
import sys
import subprocess
import time

mode, pid_path, events_path = sys.argv[1:]
with open(pid_path, 'w', encoding='utf-8') as output:
    output.write(str(os.getpid()))
if mode.startswith('tree'):
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(pid_path + '.child', 'w', encoding='utf-8') as output:
        output.write(str(child.pid))
for line in sys.stdin:
    request = json.loads(line)
    method = request.get('method', '')
    with open(events_path, 'a', encoding='utf-8') as output:
        output.write(method + '\n')
    if 'id' not in request:
        continue
    if (mode in ('initialize_hang', 'tree_initialize_hang') and method == 'initialize') or (mode == 'list_hang' and method == 'tools/list'):
        time.sleep(60)
        continue
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fixture', 'version': '1'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'echo', 'description': 'Local fixture echo', 'inputSchema': {'type': 'object'}}]}
        if mode == 'cycle':
            result['nextCursor'] = 'again'
            if request.get('params', {}).get('cursor'):
                result['tools'] = []
    elif method == 'tools/call':
        if mode == 'protocol_error':
            print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32602, 'message': 'fixture invalid arguments'}}), flush=True)
            continue
        if mode == 'disconnect':
            sys.exit(0)
        if mode == 'call_hang':
            time.sleep(60)
            continue
        result = {'content': [{'type': 'text', 'text': 'fixture response'}], 'isError': mode == 'tool_error'}
    else:
        result = {}
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
