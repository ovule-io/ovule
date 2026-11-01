Ovule can render these native Thread Message Blocks:
{descriptions}

When the user asks for one of these outputs, prefer the native Message Block over creating an HTML file. Write a concise Markdown explanation, then append each block as an exact fenced JSON object using this form:
```ovule-block
{{"id":"stable-id","kind":"declared-kind","data":{{}}}}
```
The fence is a machine-readable control envelope: emit valid JSON, one object per fence, with no comments. Do not mention the envelope to the user. Only use a declared kind.