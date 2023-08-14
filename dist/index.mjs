'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    if (node.parentNode) {
        node.parentNode.removeChild(node);
    }
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.data === data)
        return;
    text.data = data;
}
function set_input_value(input, value) {
    input.value = value == null ? '' : value;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
/**
 * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
 * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
 * it can be called from an external module).
 *
 * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
 *
 * https://svelte.dev/docs#run-time-svelte-onmount
 */
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}

const dirty_components = [];
const binding_callbacks = [];
let render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = /* @__PURE__ */ Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();
let flushidx = 0; // Do *not* move this inside the flush() function
function flush() {
    // Do not reenter flush while dirty components are updated, as this can
    // result in an infinite loop. Instead, let the inner flush handle it.
    // Reentrancy is ok afterwards for bindings etc.
    if (flushidx !== 0) {
        return;
    }
    const saved_component = current_component;
    do {
        // first, call beforeUpdate functions
        // and update components
        try {
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
        }
        catch (e) {
            // reset dirty state to not end up in a deadlocked state and then rethrow
            dirty_components.length = 0;
            flushidx = 0;
            throw e;
        }
        set_current_component(null);
        dirty_components.length = 0;
        flushidx = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    seen_callbacks.clear();
    set_current_component(saved_component);
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
/**
 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
 */
function flush_render_callbacks(fns) {
    const filtered = [];
    const targets = [];
    render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
    targets.forEach((c) => c());
    render_callbacks = filtered;
}
const outroing = new Set();
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
            // if the component was destroyed immediately
            // it will update the `$$.on_destroy` reference to `null`.
            // the destructured on_destroy may still reference to the old array
            if (component.$$.on_destroy) {
                component.$$.on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        flush_render_callbacks($$.after_update);
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: [],
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false,
        root: options.target || parent_component.$$.root
    };
    append_styles && append_styles($$.root);
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        if (!is_function(callback)) {
            return noop;
        }
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

/* src\Jsondata.svelte generated by Svelte v3.59.2 */

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[7] = list[i];
	child_ctx[9] = i;
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[10] = list[i];
	return child_ctx;
}

// (50:3) {#each colNames as col}
function create_each_block_1(ctx) {
	let th;
	let t0_value = /*col*/ ctx[10] + "";
	let t0;
	let t1;
	let mounted;
	let dispose;

	return {
		c() {
			th = element("th");
			t0 = text(t0_value);
			t1 = text(" ↕");
		},
		m(target, anchor) {
			insert(target, th, anchor);
			append(th, t0);
			append(th, t1);

			if (!mounted) {
				dispose = listen(th, "click", function () {
					if (is_function(/*sort*/ ctx[1](/*col*/ ctx[10]))) /*sort*/ ctx[1](/*col*/ ctx[10]).apply(this, arguments);
				});

				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty & /*colNames*/ 4 && t0_value !== (t0_value = /*col*/ ctx[10] + "")) set_data(t0, t0_value);
		},
		d(detaching) {
			if (detaching) detach(th);
			mounted = false;
			dispose();
		}
	};
}

// (54:8) {#each visibleUsers as user, index}
function create_each_block(ctx) {
	let tr;
	let td0;
	let t0_value = /*user*/ ctx[7].id + "";
	let t0;
	let t1;
	let td1;
	let t2_value = /*user*/ ctx[7].name + "";
	let t2;
	let t3;
	let td2;
	let t4_value = /*user*/ ctx[7].username + "";
	let t4;
	let t5;
	let td3;
	let t6_value = /*user*/ ctx[7].email + "";
	let t6;
	let t7;
	let td4;
	let t8_value = /*user*/ ctx[7].address.street + "";
	let t8;
	let t9;
	let td5;
	let t10_value = /*user*/ ctx[7].phone + "";
	let t10;
	let t11;
	let td6;
	let t12_value = /*user*/ ctx[7].website + "";
	let t12;
	let t13;
	let td7;
	let t14_value = /*user*/ ctx[7].company.name + "";
	let t14;
	let t15;

	return {
		c() {
			tr = element("tr");
			td0 = element("td");
			t0 = text(t0_value);
			t1 = space();
			td1 = element("td");
			t2 = text(t2_value);
			t3 = space();
			td2 = element("td");
			t4 = text(t4_value);
			t5 = space();
			td3 = element("td");
			t6 = text(t6_value);
			t7 = space();
			td4 = element("td");
			t8 = text(t8_value);
			t9 = space();
			td5 = element("td");
			t10 = text(t10_value);
			t11 = space();
			td6 = element("td");
			t12 = text(t12_value);
			t13 = space();
			td7 = element("td");
			t14 = text(t14_value);
			t15 = space();
		},
		m(target, anchor) {
			insert(target, tr, anchor);
			append(tr, td0);
			append(td0, t0);
			append(tr, t1);
			append(tr, td1);
			append(td1, t2);
			append(tr, t3);
			append(tr, td2);
			append(td2, t4);
			append(tr, t5);
			append(tr, td3);
			append(td3, t6);
			append(tr, t7);
			append(tr, td4);
			append(td4, t8);
			append(tr, t9);
			append(tr, td5);
			append(td5, t10);
			append(tr, t11);
			append(tr, td6);
			append(td6, t12);
			append(tr, t13);
			append(tr, td7);
			append(td7, t14);
			append(tr, t15);
		},
		p(ctx, dirty) {
			if (dirty & /*visibleUsers*/ 8 && t0_value !== (t0_value = /*user*/ ctx[7].id + "")) set_data(t0, t0_value);
			if (dirty & /*visibleUsers*/ 8 && t2_value !== (t2_value = /*user*/ ctx[7].name + "")) set_data(t2, t2_value);
			if (dirty & /*visibleUsers*/ 8 && t4_value !== (t4_value = /*user*/ ctx[7].username + "")) set_data(t4, t4_value);
			if (dirty & /*visibleUsers*/ 8 && t6_value !== (t6_value = /*user*/ ctx[7].email + "")) set_data(t6, t6_value);
			if (dirty & /*visibleUsers*/ 8 && t8_value !== (t8_value = /*user*/ ctx[7].address.street + "")) set_data(t8, t8_value);
			if (dirty & /*visibleUsers*/ 8 && t10_value !== (t10_value = /*user*/ ctx[7].phone + "")) set_data(t10, t10_value);
			if (dirty & /*visibleUsers*/ 8 && t12_value !== (t12_value = /*user*/ ctx[7].website + "")) set_data(t12, t12_value);
			if (dirty & /*visibleUsers*/ 8 && t14_value !== (t14_value = /*user*/ ctx[7].company.name + "")) set_data(t14, t14_value);
		},
		d(detaching) {
			if (detaching) detach(tr);
		}
	};
}

function create_fragment(ctx) {
	let input;
	let t0;
	let table;
	let tr;
	let t1;
	let mounted;
	let dispose;
	let each_value_1 = /*colNames*/ ctx[2];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	let each_value = /*visibleUsers*/ ctx[3];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	return {
		c() {
			input = element("input");
			t0 = space();
			table = element("table");
			tr = element("tr");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t1 = space();

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			attr(input, "type", "search");
			attr(input, "placeholder", "Search");
			attr(table, "rows", /*visibleUsers*/ ctx[3]);
		},
		m(target, anchor) {
			insert(target, input, anchor);
			set_input_value(input, /*search*/ ctx[0]);
			insert(target, t0, anchor);
			insert(target, table, anchor);
			append(table, tr);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(tr, null);
				}
			}

			append(table, t1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(table, null);
				}
			}

			if (!mounted) {
				dispose = listen(input, "input", /*input_input_handler*/ ctx[6]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (dirty & /*search*/ 1 && input.value !== /*search*/ ctx[0]) {
				set_input_value(input, /*search*/ ctx[0]);
			}

			if (dirty & /*sort, colNames*/ 6) {
				each_value_1 = /*colNames*/ ctx[2];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
					} else {
						each_blocks_1[i] = create_each_block_1(child_ctx);
						each_blocks_1[i].c();
						each_blocks_1[i].m(tr, null);
					}
				}

				for (; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].d(1);
				}

				each_blocks_1.length = each_value_1.length;
			}

			if (dirty & /*visibleUsers*/ 8) {
				each_value = /*visibleUsers*/ ctx[3];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(table, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}

			if (dirty & /*visibleUsers*/ 8) {
				attr(table, "rows", /*visibleUsers*/ ctx[3]);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(input);
			if (detaching) detach(t0);
			if (detaching) detach(table);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
			mounted = false;
			dispose();
		}
	};
}

let sourceJson = "users";

function instance($$self, $$props, $$invalidate) {
	let visibleUsers;
	let sort;
	let users = [];
	let colNames = [];
	let search = undefined;

	onMount(async () => {
		const resp = await fetch(`https://jsonplaceholder.typicode.com/` + sourceJson);
		const data = await resp.json();
		$$invalidate(4, users = data);

		//grab column names
		$$invalidate(2, colNames = Object.keys(users[0]));

		console.log(users);
	});

	let sortBy = { col: "name", ascending: true };

	function input_input_handler() {
		search = this.value;
		$$invalidate(0, search);
	}

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*sortBy, users*/ 48) {
			$$invalidate(1, sort = column => {
				if (sortBy.col == column) {
					$$invalidate(5, sortBy.ascending = !sortBy.ascending, sortBy);
				} else {
					$$invalidate(5, sortBy.col = column, sortBy);
					$$invalidate(5, sortBy.ascending = true, sortBy);
				}

				let sortModifier = sortBy.ascending ? 1 : -1;

				let sort = (a, b) => a[column] < b[column]
				? -1 * sortModifier
				: a[column] > b[column] ? 1 * sortModifier : 0;

				$$invalidate(4, users = users.sort(sort));
			});
		}

		if ($$self.$$.dirty & /*search, users*/ 17) {
			$$invalidate(3, visibleUsers = search
			? users.filter(user => {
					return user.name.match(`${search}.*`) || user.username.match(`${search}.*`);
				})
			: users);
		}
	};

	return [search, sort, colNames, visibleUsers, users, sortBy, input_input_handler];
}

class Jsondata extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, {});
	}
}

module.exports = Jsondata;
