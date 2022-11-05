const BUFFERS = [];
const CALLBACKS = [];
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

function closecmd() {
    const s = bar.textContent.slice(1);
    bar.classList.remove('prompt');
    bar.contentEditable = false;
    frame.readOnly = false;
    normalMode();
    hideItems();
    return s.trim().toLowerCase().split(/\s+/);
}

async function copy(f, ...args) {
    let n1 = args.at(-1);
    let [n2, s, ...rargs] = args.slice(0, -1);
    let initialPostion = s ?? frame.selectionEnd;
    finalPosition = initialPostion;
    
    while (n1--) {
	finalPosition = f(n2, finalPosition, ...rargs);
    }
    
    const [x, y] = [initialPostion, finalPosition].sort((x, y) => x - y);
    CLIPBOARD = frame.value.slice(x, y);
    await navigator.clipboard.writeText(CLIPBOARD);
    frame.setSelectionRange(y, y);
    return y;
}

function createBuffer(name = '*rascunho*') {
    if (BUFFER) BUFFER.text = frame.value;

    if (!BUFFERS.some(b => b.name === name)) {
	BUFFER = {};
	BUFFER.name = name;
	BUFFER.text = '';
	BUFFER.history = {REDO: [], UNDO: []};
	BUFFERS.push(BUFFER);
	displayBuffer(BUFFER);
	setPosition();
    }
}

async function cut(f, ...args) {
    let n1 = args.at(-1);
    let [n2, s, ...rargs] = args.slice(0, -1);
    let initialPostion = s ?? frame.selectionEnd;
    finalPosition = initialPostion;
    while (n1--) {
	finalPosition = f(n2, finalPosition, ...rargs);
    }
    const [x, y] = [initialPostion, finalPosition].sort((x, y) => x - y);

    CLIPBOARD = frame.value.slice(x, y);
    await navigator.clipboard.writeText(CLIPBOARD);
    frame.setRangeText('', x, y);
    frame.setSelectionRange(x, x);
    return x;
}

function displayBuffer({name, text}) {
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

function hideItems() {
    Array.from(items.children).forEach(c => items.removeChild(c));
}

function increment(n) {
    N = 10 * (N ?? 0) + n;
}

function insertMode() {
    setMode(INSERT);
    frame.focus();
}

function joinLines(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    let finalPosition = initialPosition;

    while (n--) {
	finalPosition = moveCursorLineEnd(1, finalPosition, false);
	const replacement = !finalPosition || /\s/.test(frame.value[finalPosition + 1]) || frame.value.slice(finalPosition - 1, finalPosition + 1) === '\n\n'
	      ? '' : ' ';

	frame.setRangeText(replacement, finalPosition, finalPosition + 1);
    }

    frame.setSelectionRange(initialPosition, initialPosition);
    return initialPosition;
}

function jumpSnippet() {
    const m = frame.value.slice(frame.selectionEnd).match(/@\{([^}]*)}/);

    if (m) {
	const initialPosition = frame.selectionEnd + m.index + 2;
	const finalPosition = initialPosition + m[1].length;
	frame.setSelectionRange(initialPosition, finalPosition);
    } else {
	const m = frame.value.match(/@\{([^}]*)}/);
	if (m) {
	    const initialPosition = m.index + 2;
	    const finalPosition = initialPosition + m[1].length;
	    frame.setSelectionRange(initialPosition, finalPosition);
	}
    }
}

function moveCursorBackward(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    const lineStart = moveCursorLineStart(1, initialPosition, false);
    const finalPosition = lineStart < initialPosition - n ? initialPosition - n : lineStart;
    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorDownward(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    if (!P) {
	const lineStart = moveCursorLineStart(1, initialPosition, false);
	P = initialPosition - lineStart;
    }

    const lineEnd = moveCursorLineEnd(n + 1, initialPosition, false);
    const lineStart = moveCursorLineStart(1, lineEnd, false);
    const finalPosition = moveCursorForward(P, lineStart);
    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorForward(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    const lineEnd = moveCursorLineEnd(1, initialPosition, false);
    const finalPosition = lineEnd > initialPosition + n ? initialPosition + n : lineEnd;
    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorLineEnd(n, s, skip=true) {
    const initialPosition = s ?? frame.selectionEnd;
    let finalPosition = initialPosition;

    if (skip && finalPosition < frame.value.length) {
	finalPosition += 1;
    }

    while (n--) {
	while (finalPosition < frame.value.length) {
	    if (frame.value[finalPosition] === '\n') break;
	    finalPosition += 1;
	}

	finalPosition += n && finalPosition < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorLineStart(n, s, skip=true) {
    const initialPosition = s ?? frame.selectionEnd;
    let finalPosition = initialPosition;

    if (skip && finalPosition) {
	finalPosition -= 1;
    }

    while (n--) {
	while (finalPosition) {
	    if (frame.value[finalPosition - 1] === '\n') break;
	    finalPosition -= 1;
	}

	finalPosition -= n && finalPosition ? 1 : 0;
    }

    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorNextWordStart(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    let finalPosition = initialPosition;

    while (n--) {
	while (finalPosition < frame.value.length) {
	    if (/[^\p{L}_\d]/u.test(frame.value[finalPosition])) break;
	    finalPosition += 1;
	}

	while (finalPosition < frame.value.length) {
	    if (/[\p{L}_\d]/u.test(frame.value[finalPosition])) break;
	    finalPosition += 1;
	    if (frame.value.slice(finalPosition - 1, finalPosition + 1) === '\n\n') break;
	}

	finalPosition += n && finalPosition < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorPreviousWordStart(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    let finalPosition = initialPosition;

    while (n--) {
	while (finalPosition) {
	    if (/[\p{L}_\d]/u.test(frame.value[finalPosition - 1])) break;
	    finalPosition -= 1;
	    if (frame.value.slice(finalPosition - 1, finalPosition + 1) === '\n\n') break;
	}

	while (finalPosition) {
	    if (/[^\p{L}_\d]/u.test(frame.value[finalPosition - 1])) break;
	    finalPosition -= 1;
	}

	finalPosition -= n && finalPosition < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function moveCursorUpward(n, s) {
    const initialPosition = s ?? frame.selectionEnd;

    if (!P) {
	const lineStart = moveCursorLineStart(1, initialPosition, false);
	P = initialPosition - lineStart;
    }

    const lineStart = moveCursorLineStart(n + 1, initialPosition, false);
    const finalPosition = moveCursorForward(P, lineStart);
    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}


function moveCursorWordEnd(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    let finalPosition = initialPosition;

    while (n--) {
	while (finalPosition < frame.value.length) {
	    if (/[\p{L}_\d]/u.test(frame.value[finalPosition])) break;
	    finalPosition += 1;
	    if (frame.value.slice(finalPosition - 1, finalPosition + 1) === '\n\n') break;
	}

	while (finalPosition < frame.value.length) {
	    if (/[^\p{L}_\d]/u.test(frame.value[finalPosition])) break;
	    finalPosition += 1;
	}

	finalPosition += n && finalPosition < frame.value.length ? 1 : 0;
    }

    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function nextSuggestion(reverse) {
    let r = reverse ? SUGGESTIONS.shift() : SUGGESTIONS.pop();
    if (r) {
	if (reverse) SUGGESTIONS.push(r);
	else SUGGESTIONS.unshift(r);
    }
    return r;
}

function normalMode() {
    setMode(NORMAL);
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

function opencmd(items) {
    frame.readOnly = true;
    bar.textContent = ':';
    bar.contentEditable = true;
    bar.focus();

    if (items) showItems(items);
    document.getSelection().collapse(bar, 1);
}

function openLines(n, s) {
    const initialPosition = s ?? frame.selectionEnd;
    const finalPosition = n < 0
	? moveCursorLineStart(1, initialPosition, false)
	: moveCursorLineEnd(1, initialPosition, false) + 1;

    const replacement = '\n'.repeat(Math.abs(n));
    frame.setRangeText(replacement, frame.selectionEnd, frame.selectionEnd);
    frame.setSelectionRange(finalPosition, finalPosition);
    return finalPosition;
}

function paste(n, s) {
    if (CLIPBOARD) {
	const initialPosition = s ?? frame.selectionEnd;
	const replacement = CLIPBOARD.repeat(n);
	const finalPosition = initialPosition + replacement.length;
	frame.setRangeText(replacement, initialPosition, initialPosition);
	frame.setSelectionRange(finalPosition, finalPosition);
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

function removeBuffer({name}) {
    const i = BUFFERS.find(b => b.name === name);
    BUFFERS.splice(i, 1);
    if (!BUFFERS.length) {
	createBuffer();
    }
    selectBuffer(1);
}

function replace(w, s) {
    if (s && s !== w) {
    	const initialPosition = frame.selectionEnd - w.length;
	frame.setRangeText(s, initialPosition, frame.selectionEnd);
	const finalPosition = initialPosition + s.length;
	frame.setSelectionRange(finalPosition, finalPosition);
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

function showItems(xs) {
    hideItems();
    for (var x of xs) {
	const li = document.createElement('li');
	li.textContent = x;
	items.appendChild(li);
    }
}

function selectBuffer(n) {
    if (BUFFER) BUFFER.text = frame.value;

    if (n > 0 && n - 1 < BUFFERS.length) {
	BUFFER = BUFFERS[n - 1];
	displayBuffer(BUFFER);
    }
}

function setMode(m) {
    MODE = m;
    bar.textContent = `-- ${m} --`;
}

function setPosition() {
    const ns = [...frame.value.slice(0, frame.selectionEnd)]
	  .reduce(function (acc, s, i) {
	      if (s === '\n') acc.push([s, i]);
	      return acc;
	  }, []);


    const l = ns.length + 1;
    const [_, i] = ns.at(-1) ?? [, 0];
    const c = frame.selectionEnd - i + (l === 1 ? 1 : 0);
    const lh = parseInt(STYLE.lineHeight);
    const fh = parseInt(STYLE.height);
    const top = fh * Math.trunc(l / Math.trunc(fh / lh));
    frame.scroll({top});
    showPosition(l, c);
}

function showPosition(l, c) {
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

function undefinep() {
    P = undefined;
}

function undo(n) {
    const state = swap(n, BUFFER.history.UNDO, BUFFER.history.REDO, HISTORY_LIMIT);
    if (state) restore(state);
}

function updateSuggestions(w) {

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

	const [command, ...args] = closecmd();
	if (command) {
	    if (/\d+/.test(command)) {
		selectBuffer(parseInt(command));
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
	    } else if ('light' === command) {
		document.body.classList.remove('dark');
	    } else if ('macro'.startsWith(command)) {
		if (args[0]) {
		    const keys = Object.keys(MACROS).sort();
		    const k = keys[keys.findIndex((_, i) => i === args[0] - 1)];

		    if (MACROS[k]) {
			showPosition('-', '-');
			const text = MACROS[k];

			frame.setRangeText(text, frame.selectionEnd, frame.selectionEnd);
			const finalPosition = frame.selectionEnd + text.length;
			frame.setSelectionRange(finalPosition, finalPosition);

			setPosition();
		    }
		} else {
		    opencmd(Object.keys(MACROS).sort().map((k, i) => `:m[acro] ${i + 1} -- ${k}`));
		}
	    } else if ('new'.startsWith(command) && args[0]) {
		createBuffer(args[0]);
	    } else if ('open'.startsWith(command)) {
		showPosition('-', '-');
		const {text, file} = await open();
		createBuffer(file.name);
		BUFFER.file = file;
		BUFFER.text = text;
		frame.value = text;
		setPosition();
	    } else if ('quit'.startsWith(command)) {
		removeBuffer(BUFFER);
	    } else if ('read'.startsWith(command)) {
		showPosition('-', '-');
		const {text} = await open();
		const finalPosition = frame.selectionEnd + text.length;
		frame.setRangeText(text, frame.selectionEnd, finalPosition);
		frame.setSelectionRange(finalPosition, finalPosition);
		setPosition();
	    } else if ('tab' === command && args[0]) {
		TAB_WIDTH = parseInt(args[0]);
	    } else if ('write'.startsWith(command)) {
		BUFFER.file = await write(BUFFER.file);
	    }
	}
    } else if ('Escape' === e.key) {
	closecmd();
    }
});

frame.addEventListener('keydown', async function (e) {
    clearTimeout(TYPING_TIMEOUT);
    showPosition('-', '-');

    if ('Escape' === e.key) {
	normalMode();
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
		jumpSnippet();
	    } else {
		frame.setRangeText(' '.repeat(TAB_WIDTH), frame.selectionEnd, frame.selectionEnd);
		const finalPosition = frame.selectionEnd + TAB_WIDTH;
		frame.setSelectionRange(finalPosition, finalPosition);
		SUGGESTIONS.splice(0);
	    }
	} else if ('NP'.includes(e.key.toUpperCase()) && e.altKey) {
	    e.preventDefault();

	    const [w] = frame.value.slice(0, frame.selectionEnd).match(/[\p{L}_\d]+$/u);
	    if (w) {
		updateSuggestions(w);
		replace(w, nextSuggestion('P' === e.key.toUpperCase()));
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
	    opencmd(BUFFERS.map((b, i) => b.name ? `:${i + 1} ${b.name}` : ''));
	} else if ('Tab' === e.key && e.shiftKey) {
	    jumpSnippet();
	} else if ('A' === e.key.toUpperCase() && e.shiftKey) {
	    after(insertMode);
	    after(undefinep);
	    exec(moveCursorLineEnd, n);
	} else if ('B' === e.key.toUpperCase() && e.shiftKey) {
	    after(undefinep);
	    exec(moveCursorLineStart, n);
	} else if ('E' === e.key.toUpperCase() && e.shiftKey) {
	    after(undefinep);
	    exec(moveCursorLineEnd, n);
	} else if ('I' === e.key.toUpperCase() && e.shiftKey) {
	    after(insertMode);
	    after(undefinep);
	    exec(moveCursorLineStart, n);
	} else if ('J' === e.key.toUpperCase() && e.shiftKey) {
	    exec(joinLines, n);
	} else if ('O' === e.key.toUpperCase() && e.shiftKey) {
	    after(insertMode);
	    after(store);
	    after(undefinep);
	    exec(openLines, -n);
	} else if ('b' === e.key) {
	    after(undefinep);
	    exec(moveCursorPreviousWordStart, n);
	} else if ('c' === e.key) {
	    after(insertMode);
	    after(undefinep);
	    after(store);
	    stack(cut, n);
	} else if ('d' === e.key) {
	    after(undefinep);
	    after(store);
	    stack(cut, n);
	} else if ('e' === e.key) {
	    after(undefinep);
	    exec(moveCursorWordEnd, n);
	} else if ('h' === e.key) {
	    after(undefinep);
	    exec(moveCursorBackward, n);
	} else if ('i' === e.key) {
	    insertMode();
	} else if ('j' === e.key) {
	    exec(moveCursorDownward, n);
	} else if ('k' === e.key) {
	    exec(moveCursorUpward, n);
	} else if ('l' === e.key) {
	    after(undefinep);
	    exec(moveCursorForward, n);
	} else if ('o' === e.key) {
	    after(insertMode);
	    after(store);
	    after(undefinep);
	    exec(openLines, n);
	} else if ('p' === e.key) {
	    after(store);
	    after(undefinep);
	    exec(paste, n);
	} else if ('r' === e.key) {
	    redo(n);
	} else if ('u' === e.key) {
	    undo(n);
	} else if ('w' === e.key) {
	    after(undefinep);
	    exec(moveCursorNextWordStart, n);
	} else if ('y' === e.key) {
	    after(store);
	    stack(copy, n);
	}
    }
});

frame.addEventListener('keyup', async function (e) {
    TYPING_TIMEOUT = setTimeout(function () {
	setPosition();
	if (INSERT === MODE) store();
    }, 100);
});

window.onload = async function () {
    createBuffer();
    normalMode();
};
