const BUFFERS = [];
const CALLBACKS = [];
const CTX = document.createElement('canvas').getContext('2d');
const HISTORY_LIMIT = 50;
const INSERT = 'INSERT';
const MACROS = {};
const MODIFIERS = [];
const NORMAL = 'NORMAL';
const READER = new FileReader();
const STYLE = getComputedStyle(frame);
const SUGGESTIONS = [];
const WORDS = new Set();

let BUFFER;
let CLIPBOARD;
let MODE;
let N;
let P;
let TYPING_TIMEOUT;
let TAB_WIDTH = 4;

function after(f, ...args) {
    CALLBACKS.unshift([f, ...args]);
}

function close_cmd() {
    const s = bar.textContent.slice(1);
    bar.classList.remove('prompt');
    bar.contentEditable = false;
    frame.readOnly = false;
    normal_mode();
    hide_items();
    return s.trim().toLowerCase().split(/\s+/);
}

async function copy(f, ...args) {
    let n1 = args.at(-1);
    let [n2, s, ...rargs] = args.slice(0, -1);
    let initial_position = s ?? frame.selectionEnd;
    final_position = initial_position;
    
    while (n1--) {
        final_position = f(n2, final_position, ...rargs);
    }
    
    const [x, y] = [initial_position, final_position].sort((x, y) => x - y);
    CLIPBOARD = frame.value.slice(x, y);
    await navigator.clipboard.writeText(CLIPBOARD);
    frame.setSelectionRange(y, y);
    return y;
}

async function copy_all() {
    CLIPBOARD = frame.value;
    await navigator.clipboard.writeText(CLIPBOARD);
    frame.setSelectionRange(0, frame.value.length);
    frame.scroll({top: frame.scrollHeight});
    return frame.value.length;
}

function create_buffer(name = '*rascunho*') {
    if (BUFFER) BUFFER.text = frame.value;

    if (!BUFFERS.some(b => b.name === name)) {
        BUFFER = {};
        BUFFER.name = name;
        BUFFER.text = '';
        BUFFER.history = {REDO: [], UNDO: []};
        BUFFERS.push(BUFFER);
        display_buffer(BUFFER);
        set_position();
    }
}

async function cut(f, ...args) {
    let n1 = args.at(-1);
    let [n2, s, ...rargs] = args.slice(0, -1);
    let initial_position = s ?? frame.selectionEnd;
    final_position = initial_position;
    while (n1--) {
        final_position = f(n2, final_position, ...rargs);
    }
    const [x, y] = [initial_position, final_position].sort((x, y) => x - y);

    CLIPBOARD = frame.value.slice(x, y);
    await navigator.clipboard.writeText(CLIPBOARD);
    frame.setRangeText('', x, y);
    frame.setSelectionRange(x, x);
    return x;
}

function dispatch(n) {
    frame.dispatchEvent(new CustomEvent('scroll-frame!', {detail: n}));
}

function display_buffer({name, text}) {
    buffername.textContent = name;
    frame.value = text;
}

function exec(f, ...args) {
    if (MODIFIERS.length) {
        MODIFIERS.reduce(function (acc, [f, ...args]) {
            return f(...acc, ...args);
        }, [f, ...args]);
    } else {
        f(...args);
    }

    CALLBACKS.forEach(([f, ...args]) => f(...args));
    reset();
}

function hide_items() {
    Array.from(items.children).forEach(c => items.removeChild(c));
}

function increment(n) {
    N = 10 * (N ?? 0) + n;
}

function insert_mode() {
    set_mode(INSERT);
    frame.focus();
}

function join_lines(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    let final_position = initial_position;

    while (n--) {
        final_position = move_cursor_line_end(1, final_position, false);
        const replacement = !final_position || /\s/.test(frame.value[final_position + 1]) || frame.value.slice(final_position - 1, final_position + 1) === '\n\n'
              ? '' : ' ';

        frame.setRangeText(replacement, final_position, final_position + 1);
    }

    frame.setSelectionRange(initial_position, initial_position);
    return initial_position;
}

function jump_snippet() {
    const m = frame.value.slice(frame.selectionEnd).match(/@\{([^}]*)}/);

    if (m) {
        const initial_position = frame.selectionEnd + m.index + 2;
        const final_position = initial_position + m[1].length;
        frame.setSelectionRange(initial_position, final_position);
    } else {
        const m = frame.value.match(/@\{([^}]*)}/);
        if (m) {
            const initial_position = m.index + 2;
            const final_position = initial_position + m[1].length;
            frame.setSelectionRange(initial_position, final_position);
        }
    }
}

function move_cursor_backward(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    const line_start = move_cursor_line_start(1, initial_position, false);
    const final_position = line_start < initial_position - n ? initial_position - n : line_start;
    frame.setSelectionRange(final_position, final_position);
    scroll_h(line_start, final_position);
    return final_position;
}

function move_cursor_downward(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    if (!P) {
        const line_start = move_cursor_line_start(1, initial_position, false);
        P = initial_position - line_start;
    }

    const line_end = move_cursor_line_end(n + 1, initial_position, false);
    const line_start = move_cursor_line_start(1, line_end, false);
    const final_position = move_cursor_forward(P, line_start);
    frame.setSelectionRange(final_position, final_position);
    return final_position;
}

function move_cursor_forward(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    const line_start = move_cursor_line_start(1, initial_position, false);
    const line_end = move_cursor_line_end(1, initial_position, false);
    const final_position = line_end > initial_position + n ? initial_position + n : line_end;
    frame.setSelectionRange(final_position, final_position);
    scroll_h(line_start, final_position);
    return final_position;
}

function move_cursor_line_end(n, s, skip=true) {
    const initial_position = s ?? frame.selectionEnd;
    let final_position = initial_position;

    let lines = 0
    if (skip && final_position < frame.value.length) {
        final_position += 1;
        lines += 1;
    }

    while (n--) {
        while (final_position < frame.value.length) {
            if (frame.value[final_position] === '\n') break;
            final_position += 1;
        }

        final_position += n && final_position < frame.value.length ? 1 : 0;
        lines += n ? 1 : 0;
    }

    dispatch(lines);
    frame.setSelectionRange(final_position, final_position);
    return final_position;
}

function move_cursor_line_start(n, s, skip=true) {
    const initial_position = s ?? frame.selectionEnd;
    let final_position = initial_position;

    let lines = 0;
    if (skip && final_position) {
        final_position -= 1;
        lines -= 1;
    }

    while (n--) {
        while (final_position) {
            if (frame.value[final_position - 1] === '\n') break;
            final_position -= 1;
        }

        final_position -= n && final_position ? 1 : 0;
        lines -= n ? 1 : 0;
    }

    frame.setSelectionRange(final_position, final_position);
    dispatch(lines);
    return final_position;
}

function move_cursor_next_word_start(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    let line_start = move_cursor_line_start(1, initial_position, false);
    let final_position = initial_position;
    
    let lines = 0;
    while (n--) {
        while (final_position < frame.value.length) {
            if (/[^\p{L}_\d]/u.test(frame.value[final_position])) break;
            final_position += 1;
        }

        while (final_position < frame.value.length) {
            if (/[\p{L}_\d]/u.test(frame.value[final_position])) break;
            final_position += 1;
            if (frame.value.slice(final_position - 1, final_position + 1) === '\n\n') {
                lines += 1;
                line_start = final_position;
                break;
            } else if (frame.value[final_position] === '\n') {
                lines += 1;
                line_start = final_position;
            }
        }

        final_position += n && final_position < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(final_position, final_position);
    dispatch(lines);
    scroll_h(line_start, final_position);
    return final_position;
}

function move_cursor_previous_start(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    let line_start = move_cursor_line_start(1, initial_position, false);
    let final_position = initial_position;

    let lines = 0;
    while (n--) {
        while (final_position) {
            if (/[\p{L}_\d]/u.test(frame.value[final_position - 1])) break;
            final_position -= 1;
            if (frame.value.slice(final_position - 1, final_position + 1) === '\n\n') {
                lines -= 1;
                line_start = final_position;
                break;
            } else if (frame.value[final_position] === '\n') {
                lines -= 1;
                line_start = final_position;
            }
        }

        while (final_position) {
            if (/[^\p{L}_\d]/u.test(frame.value[final_position - 1])) break;
            final_position -= 1;
        }

        final_position -= n && final_position < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(final_position, final_position);
    dispatch(lines);
    scroll_h(line_start, final_position);
    return final_position;
}

function move_cursor_upward(n, s) {
    const initial_position = s ?? frame.selectionEnd;

    if (!P) {
        const line_start = move_cursor_line_start(1, initial_position, false);
        P = initial_position - line_start;
    }

    const line_start = move_cursor_line_start(n + 1, initial_position, false);
    const final_position = move_cursor_forward(P, line_start);
    frame.setSelectionRange(final_position, final_position);
    return final_position;
}

function move_cursor_word_end(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    let line_start = move_cursor_line_start(1, initial_position, false);
    let final_position = initial_position;
    let lines = 0;
    while (n--) {
        while (final_position < frame.value.length) {
            if (/[\p{L}_\d]/u.test(frame.value[final_position])) break;
            final_position += 1;
            if (frame.value.slice(final_position - 1, final_position + 1) === '\n\n') {
                lines += 1;
                line_start = final_position;
                break;
            } else if (frame.value[final_position] === '\n') {
                lines += 1;
                line_start = final_position;
            }
        }

        while (final_position < frame.value.length) {
            if (/[^\p{L}_\d]/u.test(frame.value[final_position])) break;
            final_position += 1;
        }

        final_position += n && final_position < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(final_position, final_position);
    dispatch(lines);
    scroll_h(line_start, final_position);
    return final_position;
}

function next_suggestion(reverse) {
    let r = reverse ? SUGGESTIONS.shift() : SUGGESTIONS.pop();
    if (r) {
        if (reverse) SUGGESTIONS.push(r);
        else SUGGESTIONS.unshift(r);
    }
    return r;
}

function normal_mode() {
    set_mode(NORMAL);
    frame.focus();
}

async function open() {
    const [file] = await showOpenFilePicker({multiple: false});
    return await new Promise(async function (resolve) {
        READER.onloadend = function ({target: {result: text}}) {
            resolve({file, text});
            text.split(/[^\p{L}_\d]/u)
                .forEach(function (w) {
                    if (w.length > 2) WORDS.add(w);
                });
        };

        READER.readAsText(await file.getFile());
    });
}

function open_cmd(items) {
    frame.readOnly = true;
    bar.textContent = ':';
    bar.contentEditable = true;
    bar.focus();

    if (items) showItems(items);
    document.getSelection().collapse(bar, 1);
}

function open_lines(n, s) {
    const initial_position = s ?? frame.selectionEnd;
    const final_position = n < 0
        ? move_cursor_line_start(1, initial_position, false)
        : move_cursor_line_end(1, initial_position, false) + 1;

    const replacement = '\n'.repeat(Math.abs(n));
    frame.setRangeText(replacement, frame.selectionEnd, frame.selectionEnd);
    frame.setSelectionRange(final_position, final_position);
    return final_position;
}

function paste(n, s) {
    if (CLIPBOARD) {
        const initial_position = s ?? frame.selectionEnd;
        const replacement = CLIPBOARD.repeat(n);
        const final_position = initial_position + replacement.length;
        frame.setRangeText(replacement, initial_position, initial_position);
        frame.setSelectionRange(final_position, final_position);
    }
}

function peek(xs) {
    return xs.at(-1);
}

function push(x, xs, limit) {
    xs.push(x);
    while (xs.length > limit) xs.shift();
}

function redo(n) {
    const state = swap(n, BUFFER.history.REDO, BUFFER.history.UNDO, HISTORY_LIMIT);
    if (state) restore(state);
}

function remove_buffer({name}) {
    const i = BUFFERS.find(b => b.name === name);
    BUFFERS.splice(i, 1);
    if (!BUFFERS.length) {
        create_buffer();
    }
    select_buffer(1);
}

function replace(w, s) {
    if (s && s !== w) {
        const initial_position = frame.selectionEnd - w.length;
        frame.setRangeText(s, initial_position, frame.selectionEnd);
        const final_position = initial_position + s.length;
        frame.setSelectionRange(final_position, final_position);
    }
}

function reset() {
    CALLBACKS.splice(0);
    MODIFIERS.splice(0);
    N = undefined;
}

function restore({end, start, text, top}) {
    frame.value = text;
    frame.setSelectionRange(start, end);
    frame.scroll({top});
}

function scroll_h(s, e) {
    CTX.font = STYLE.font;
    const fz = parseInt(STYLE.fontSize);
    const t = frame.value.slice(s, e + 1);
    const w = parseInt(STYLE.width);
    const tw = parseInt(CTX.measureText(t).width);
    frame.scroll({top: frame.scrollTop, left: Math.trunc(tw / w) * w - fz});
}

function showItems(xs) {
    hide_items();
    for (var x of xs) {
        const li = document.createElement('li');
        li.textContent = x;
        items.appendChild(li);
    }
}

function select_buffer(n) {
    if (BUFFER) BUFFER.text = frame.value;

    if (n > 0 && n - 1 < BUFFERS.length) {
        BUFFER = BUFFERS[n - 1];
        display_buffer(BUFFER);
    }
}

function set_mode(m) {
    MODE = m;
    bar.textContent = `-- ${m} --`;
}

function set_position() {
    const ns = [...frame.value.slice(0, frame.selectionEnd)]
          .reduce(function (acc, s, i) {
              if (s === '\n') acc.push([s, i]);
              return acc;
          }, []);

    const l = ns.length + 1;
    const [_, i] = ns.at(-1) ?? [, 0];
    const c = frame.selectionEnd - i + (l === 1 ? 1 : 0);

    show_position(l, c);
}

function show_position(l, c) {
    position.textContent = `${l},${c}`;
}

function stack(f, ...args) {
    if (!MODIFIERS.some(([f1]) => f1 === f)) MODIFIERS.unshift([f, ...args]);
    N = undefined;
}

function store() {
    BUFFER.text = frame.value;
    const state = {
        end: frame.selectionEnd,
        start: frame.selectionStart,
        text: BUFFER.text,
        top: frame.scrollTop,
    };
    push(state, BUFFER.history.UNDO, HISTORY_LIMIT);
}

function swap(n, xs, ys, limit) {
    let r;

    while (n--) {
        let x = xs.pop();

        if (!x) break;
        r = x;
        ys.push(r);
    }

    return r;
}

function undefine_p() {
    P = undefined;
}

function undo(n) {
    const state = swap(n, BUFFER.history.UNDO, BUFFER.history.REDO, HISTORY_LIMIT);
    if (state) restore(state);
}

function update_suggestions(w) {

    if (!SUGGESTIONS.length) {
        const re = new RegExp('^' + w.split('').join('.*'));

        [...WORDS]
            .filter(s => re.test(s))
            .forEach(w => SUGGESTIONS.push(w));

        SUGGESTIONS.push(w);
    }

    return w;
}

async function write(file) {
    if (!file) {
        file = await showSaveFilePicker({multiple: false});
    }

    const w = await file.createWritable();
    await w.write(new Blob([frame.value]));
    await w.close();
    return file;
}

bar.addEventListener('keydown', async function (e) {
    if ('Backspace' === e.key) {
        if (bar.textContent.length === 1) e.preventDefault();
    } else if ('Enter' === e.key) {
        e.preventDefault();

        const [command, ...args] = close_cmd();
        if (command) {
            if (/\d+/.test(command)) {
                select_buffer(parseInt(command));
            } else if ('+' === command && args[0]) {
                if (confirm(`Add macro ${args[0]}?`)) {
                    MACROS[args[0]] = frame.value;
                }
            } else if ('abc' === command) {
                frame.spellcheck = true;
            } else if ('!abc' === command) {
                frame.spellcheck = false;
            } else if ('clear'.startsWith(command)) {
                BUFFER.text = '';
                frame.value = '';
            } else if ('dark' === command) {
                document.body.classList.add('dark');
            } else if ('fixed'.startsWith(command)) {
                frame.value = frame.value.replaceAll(/@\{([^}]*)}/g, '$1');
            } else if ('light' === command) {
                document.body.classList.remove('dark');
            } else if ('macro'.startsWith(command)) {
                if (args[0]) {
                    const keys = Object.keys(MACROS).sort();
                    const k = keys[keys.findIndex((_, i) => i === args[0] - 1)];

                    if (MACROS[k]) {
                        show_position('-', '-');
                        const text = MACROS[k];

                        frame.setRangeText(text, frame.selectionEnd, frame.selectionEnd);
                        const final_position = frame.selectionEnd + text.length;
                        frame.setSelectionRange(final_position, final_position);

                        set_position();
                    }
                } else {
                    open_cmd(Object.keys(MACROS).sort().map((k, i) => `:m[acro] ${i + 1} -- ${k}`));
                }
            } else if ('new'.startsWith(command) && args[0]) {
                create_buffer(args[0]);
            } else if ('open'.startsWith(command)) {
                show_position('-', '-');
                const {text, file} = await open();
                create_buffer(file.name);
                BUFFER.file = file;
                BUFFER.text = text;
                frame.value = text;
                set_position();
            } else if ('quit'.startsWith(command)) {
                remove_buffer(BUFFER);
            } else if ('read'.startsWith(command)) {
                show_position('-', '-');
                let {text} = await open();
                text = text.replaceAll(/\t/g, ' '.repeat(TAB_WIDTH));
		const final_position = frame.selectionEnd + text.length;
		frame.setRangeText(text, frame.selectionEnd, final_position);
		frame.setSelectionRange(0, 0);
		frame.scroll({top: 0});
		set_position();
	    } else if ('tab' === command && args[0]) {
		TAB_WIDTH = parseInt(args[0]);
	    } else if ('write'.startsWith(command)) {
		BUFFER.file = await write(BUFFER.file);
	    }
	}
    } else if ('Escape' === e.key) {
	close_cmd();
    }
});

frame.addEventListener('keydown', async function (e) {
    clearTimeout(TYPING_TIMEOUT);
    show_position('-', '-');

    if ('Escape' === e.key) {
	normal_mode();
	reset();
    } else if (INSERT === MODE) {

	if (/[^\p{L}_\d]|Enter|Tab/u.test(e.key)) {
	    const s = frame.value.slice(0, frame.selectionEnd);
	    const [m] = s.match(/[\p{L}_\d]+$/u) || [];
	    if (m?.length > 2) WORDS.add(m);
	}

	if ('Tab' === e.key) {
	    e.preventDefault();

	    if (e.shiftKey) {
		jump_snippet();
	    } else {
		frame.setRangeText(' '.repeat(TAB_WIDTH), frame.selectionEnd, frame.selectionEnd);
		const final_position = frame.selectionEnd + TAB_WIDTH;
		frame.setSelectionRange(final_position, final_position);
		SUGGESTIONS.splice(0);
	    }
	} else if ('NP'.includes(e.key.toUpperCase()) && e.altKey) {
	    e.preventDefault();

	    const [w] = frame.value.slice(0, frame.selectionEnd).match(/[\p{L}_\d]+$/u);
	    if (w) {
		update_suggestions(w);
		replace(w, next_suggestion('P' === e.key.toUpperCase()));
	    }

	} else {
	    SUGGESTIONS.splice(0);
	}

    } else if (NORMAL === MODE) {
	e.preventDefault();

	const n = N ?? 1;
	if (/\d/.test(e.key)) {
	    increment(parseInt(e.key));
	} else if (':' === e.key) {
	    open_cmd(BUFFERS.map((b, i) => b.name ? `:${i + 1} ${b.name}` : ''));
	} else if ('Tab' === e.key && e.shiftKey) {
	    jump_snippet();
	} else if ('A' === e.key.toUpperCase() && e.shiftKey) {
	    after(insert_mode);
	    after(undefine_p);
	    exec(move_cursor_line_end, n);
	} else if ('B' === e.key.toUpperCase() && e.shiftKey) {
	    after(undefine_p);
	    exec(move_cursor_line_start, n);
	} else if ('E' === e.key.toUpperCase() && e.shiftKey) {
	    after(undefine_p);
	    exec(move_cursor_line_end, n);
	} else if ('I' === e.key.toUpperCase() && e.shiftKey) {
	    after(insert_mode);
	    after(undefine_p);
	    exec(move_cursor_line_start, n);
	} else if ('J' === e.key.toUpperCase() && e.shiftKey) {
	    after(store);
	    exec(join_lines, n);
	} else if ('O' === e.key.toUpperCase() && e.shiftKey) {
	    after(insert_mode);
	    after(store);
	    after(undefine_p);
	    exec(open_lines, -n);
	} else if ('X' === e.key) {
	    after(store);
	    stack(cut, 1);
	    exec(move_cursor_backward, n);
	} else if ('a' === e.key && e.ctrlKey) {
	    exec(copy_all);
	} else if ('b' === e.key) {
	    after(undefine_p);
	    exec(move_cursor_previous_start, n);
	} else if ('c' === e.key) {
	    after(insert_mode);
	    after(undefine_p);
	    after(store);
	    stack(cut, n);
	} else if ('d' === e.key) {
	    after(undefine_p);
	    after(store);
	    stack(cut, n);
	} else if ('e' === e.key) {
	    after(undefine_p);
	    exec(move_cursor_word_end, n);
	} else if ('h' === e.key) {
	    after(undefine_p);
	    exec(move_cursor_backward, n);
	} else if ('i' === e.key) {
	    insert_mode();
	} else if ('j' === e.key) {
	    exec(move_cursor_downward, n);
	} else if ('k' === e.key) {
	    exec(move_cursor_upward, n);
	} else if ('l' === e.key) {
	    after(undefine_p);
	    exec(move_cursor_forward, n);
	} else if ('o' === e.key) {
	    after(insert_mode);
	    after(store);
	    after(undefine_p);
	    exec(open_lines, n);
	} else if ('p' === e.key) {
	    after(store);
	    after(undefine_p);
	    exec(paste, n);
	} else if ('r' === e.key) {
	    redo(n);
	} else if ('u' === e.key) {
	    undo(n);
	} else if ('x' === e.key) {
	    after(store);
	    stack(cut, 1);
	    exec(move_cursor_forward, n);
	} else if ('w' === e.key) {
	    after(undefine_p);
	    exec(move_cursor_next_word_start, n);
	} else if ('y' === e.key) {
	    after(store);
	    stack(copy, n);
	}
    }
});

frame.addEventListener('keyup', async function (e) {
    TYPING_TIMEOUT = setTimeout(function () {
	set_position();
	if (INSERT === MODE) store();
    }, 100);
});

frame.addEventListener('scroll-frame!', async function (e) {
    const top = frame.scrollTop + parseInt(STYLE.lineHeight) * e.detail;
    frame.scroll({top});
});

window.onload = async function () {
    create_buffer();
    normal_mode();
};
