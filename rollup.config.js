import svelte from 'rollup-plugin-svelte';
import commonjs from '@rollup/plugin-commonjs';
import resolve from "@rollup/plugin-node-resolve";
import css from "rollup-plugin-css-only";
import json from '@rollup/plugin-json';

const pkg = require('./package.json');

export default {
    input: 'src/Jsondata.svelte',
    output: [
        { file: pkg.module, 'format': 'cjs' },
        { file: pkg.main, 'format': 'cjs', name: 'Jsondata' }
    ],
    plugins: [
        json(),
        svelte(),
        css({ output: 'styles.css' }),
        resolve(),
        commonjs({include: 'node_modules/**'})
    ],
};