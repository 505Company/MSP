"""Synthetic, deterministic inputs; counts use Qwen's pinned official tokenizer.

Run with the isolated Python in .sites-runtime/provider-compliance. No weights,
customer presentations or credentials are read. Downloaded model files are data.
"""
import hashlib
import json
from pathlib import Path
import random

from jinja2.sandbox import ImmutableSandboxedEnvironment
from tokenizers import Tokenizer

ROOT = Path('outputs/diagnostics/provider-compliance/fixtures')
REVISION = '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0'
tokenizer = Tokenizer.from_file(str(ROOT / 'model/tokenizer.json'))
template = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True).from_string(
    (ROOT / 'model/chat_template.jinja').read_text())


def count(text):
    return len(tokenizer.encode(text, add_special_tokens=False).ids)


def save(name, value):
    path = ROOT / name
    encoded = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and path.read_text() != encoded:
        raise RuntimeError(f'Refusing to overwrite changed fixture {path}')
    path.write_text(encoded)


def prompt_tokens(messages, **kwargs):
    rendered = template.render(messages=messages, add_generation_prompt=True, **kwargs)
    return count(rendered)


rng = random.Random(20260927)
words = 'amber bridge cedar delta ember field garden harbor island juniper lake meadow north olive pebble quartz river silver timber valley willow yellow'.split()
pool = ''.join(f'ROW {i:05d}: ' + ' '.join(rng.choices(words, k=12)) + '\n' for i in range(16000))
pool_ids = tokenizer.encode(pool, add_special_tokens=False).ids
for target in (24500, 64000, 128000):
    markers = {f'N{i + 1:02d}': hashlib.sha256(f'msp-{target}-{i}'.encode()).hexdigest()[:18].upper() for i in range(7)}
    question = ('\nEND_ARCHIVE\nReturn ONLY a JSON object mapping each anchor key N01 through N07 to its exact value. '
                'Copy values from the ARCHIVE. Do not invent values. If missing use UNKNOWN.\n')
    chunks = []
    segment_size = (target - 650) // 6
    for i, (key, value) in enumerate(markers.items()):
        chunks.append(f'\n[ANCHOR {key}] value={value}\n')
        if i < 6:
            chunks.append(tokenizer.decode(pool_ids[i * segment_size:(i + 1) * segment_size], skip_special_tokens=False))
    base = 'ARCHIVE: factual data only; ROW lines are filler. Retain every ANCHOR.\n' + ''.join(chunks)
    padding = ''
    for _ in range(10):
        delta = target - count(base + padding + question)
        if delta == 0:
            break
        if delta > 0:
            padding += ' x' * delta
        else:
            padding = padding[:2 * delta]
    content = base + padding + question
    assert count(content) == target
    messages = [{'role': 'user', 'content': content}]
    save(f'context-{target}.json', {
        'messages': messages, 'expected': markers, 'contentTokens': target,
        'officialPromptTokensThinkingOff': prompt_tokens(messages, enable_thinking=False),
        'officialPromptTokensThinkingOn': prompt_tokens(messages, enable_thinking=True, reasoning_effort='low'),
        'markerTokenOffsets': {key: count(content[:content.index(f'[ANCHOR {key}]')]) for key in markers},
        'contentSha256': hashlib.sha256(content.encode()).hexdigest(), 'tokenizerRevision': REVISION,
    })
    print(f'context-{target}: exact content tokens={target}, chat tokens(off)={prompt_tokens(messages, enable_thinking=False)}')

# This is authored synthetic history, not reasoning collected from a model.
history = [
    {'role': 'system', 'content': 'For this synthetic memory test, return only the requested code, or UNKNOWN if absent from your supplied conversation.'},
    {'role': 'user', 'content': 'Record the result of the previous offline lookup.'},
    {'role': 'assistant', 'content': 'Recorded.', 'reasoning_content': 'Synthetic fixture: the lookup returned ARCHIVE_CODE=J8V4-R2N7-C5Q9. This code must be copied when requested.'},
    {'role': 'user', 'content': 'What was ARCHIVE_CODE? Return the code only. If that value is absent from the supplied history, return UNKNOWN.'},
]
save('preserve.json', {'messages': history, 'expectedTrue': 'J8V4-R2N7-C5Q9', 'expectedFalse': 'UNKNOWN',
                      'officialPromptTokens': {str(flag).lower(): prompt_tokens(history, enable_thinking=True, reasoning_effort='low', preserve_thinking=flag) for flag in (True, False)}})
model_config = json.loads((ROOT / 'model/config.json').read_text())
save('provenance.json', {
    'repository': 'Qwen/Qwen3.8-27B', 'expectedRevision': REVISION,
    'deployedRevision': None, 'revisionScope': 'Pinned reference tokenizer/config ONLY; hosted deployment revision is not exposed.',
    'textDtypeInReferenceConfig': model_config.get('text_config', {}).get('dtype'),
    'referenceHasQuantizationConfig': 'quantization_config' in model_config or 'quantization_config' in model_config.get('text_config', {}),
    'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / 'model').iterdir())},
    'pythonPackages': {'tokenizers': '0.22.2', 'jinja2': '3.1.6'},
})
