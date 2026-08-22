#!/bin/bash

# Fix package.json
sed -i '' -e '/<<<<<<< HEAD/,/======={/d' -e '/>>>>>>> origin\/main/d' backend/package.json
# Wait, this might be tricky with sed. Let's use python to fix conflicts.

cat << 'PYEOF' > fix.py
import re

def resolve_file(filepath, replacement_map):
    with open(filepath, 'r') as f:
        content = f.read()
    
    for marker, replacement in replacement_map.items():
        # find the conflict block
        pattern = re.compile(r'<<<<<<< HEAD.*?=======\n(.*?)\n>>>>>>> origin/main', re.DOTALL)
        content = re.sub(r'<<<<<<< HEAD.*?=======\n.*?\n>>>>>>> origin/main', replacement, content, count=1, flags=re.DOTALL)
        
    with open(filepath, 'w') as f:
        f.write(content)

PYEOF

python3 -c "
import re

def resolve(filepath, replacement):
    with open(filepath, 'r') as f:
        content = f.read()
    # Replace all conflict blocks in the file with the replacement
    content = re.sub(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> origin/main', replacement, content, flags=re.DOTALL)
    with open(filepath, 'w') as f:
        f.write(content)

"
