Steps to build `cm6.bundle.ubol.min.js` -- command line from repo root:

- `git submodule init platform/mv3/extension/lib/codemirror/codemirror-ubol`
- `cd platform/mv3/extension/lib/codemirror/codemirror-ubol/`
    - We are now in a customized repo forked from <https://github.com/RPGillespie6/codemirror-quickstart>
- `npm install`
- `npm run build`
- `cm6.bundle.ubol.min.js` should be in `dist` directory
- This is the origin of the `cm6.bundle.ubol.min.js` in the current directory
