/* vim: set shiftwidth=2 tabstop=2 noexpandtab textwidth=80 wrap : */
"use strict";

module.exports = diff;

function diff(a, b, eql) {
    if (!eql)
        eql = function (a, b) { return a === b; };

    var d = new Diff(a, b, eql);
    return d.editscript();
}

diff.Diff = Diff;

function Diff(a, b, eql) {
    this.a = a;
    this.b = b;
    this.eql = eql;

    this.moda = Array.apply(null, new Array(a.length)).map(true.valueOf, false);
    this.modb = Array.apply(null, new Array(b.length)).map(true.valueOf, false);

    // just to save some allocations:
    this.down = {};
    this.up = {};

    this.lcs(0, a.length, 0, b.length);
}

Diff.NOOP    = 'nop';
Diff.DELETE  = 'del';
Diff.INSERT  = 'ins';
Diff.REPLACE = 'rep';

Diff.prototype.editscript = function Diff_editscript() {
    var moda = this.moda, modb = this.modb;
    var astart = 0, aend = moda.length;
    var bstart = 0, bend = modb.length;
    var result = [];
    while (astart < aend || bstart < bend) {
        if (astart < aend && bstart < bend) {
            if (!moda[astart] && !modb[bstart]) {
                result.push(Diff.NOOP);
                astart++; bstart++;
                continue;
            } else if (moda[astart] && modb[bstart]) {
                result.push(Diff.REPLACE);
                astart++; bstart++;
                continue;
            }
        }
        if (astart < aend && (bstart >= bend || moda[astart])) {
            result.push(Diff.DELETE);
            astart++;
        }
        if (bstart < bend && (astart >= aend || modb[bstart])) {
            result.push(Diff.INSERT);
            bstart++;
        }
    }
    return result;
};

Diff.prototype.lcs = function Diff_lcs(astart, aend, bstart, bend) {
    var a = this.a, b = this.b, eql = this.eql;
    // separate common head
    while (astart < aend && bstart < bend && eql(a[astart], b[bstart])) {
        astart++; bstart++;
    }
    // separate common tail
    while (astart < aend && bstart < bend && eql(a[aend - 1], b[bend - 1])) {
        aend--; bend--;
    }

    if (astart === aend) {
        // only insertions
        while (bstart < bend) {
            this.modb[bstart] = true;
            bstart++;
        }
    } else if (bend === bstart) {
        // only deletions
        while (astart < aend) {
            this.moda[astart] = true;
            astart++;
        }
    } else {
        var snake = this.snake(astart, aend, bstart, bend);

        this.lcs(astart, snake.x, bstart, snake.y);
        this.lcs(snake.u, aend, snake.v, bend);
    }
};

Diff.prototype.snake = function Diff_snake(astart, aend, bstart, bend) {
    var a = this.a, b = this.b, eql = this.eql;

    var N = aend - astart,
        M = bend - bstart;

    var kdown = astart - bstart;
    var kup   = aend   - bend;

    var delta = N - M;
    var deltaOdd = delta & 1;

    var down = this.down;
    down[kdown + 1] = astart;
    var up = this.up;
    up[kup - 1] = aend;

    var Dmax = (N + M + 1) / 2;
    for (var D = 0; D <= Dmax; D++) {
        var k, x, y;
        // forward path
        for (k = kdown - D; k <= kdown + D; k += 2) {
            if (k === kdown - D) {
                x = down[k + 1]; // down
            } else {
                x = down[k - 1] + 1; // right
                if ((k < kdown + D) && (down[k + 1] >= x)) {
                    x = down[k + 1]; // down
                }
            }
            y = x - k;

            while (x < aend && y < bend && eql(a[x], b[y])) {
                x++; y++; // diagonal
            }
            down[k] = x;

            if (deltaOdd && (kup - D < k) && (k < kup + D) &&
                up[k] <= down[k]) {
                return {
                    x: down[k],
                    y: down[k] - k,
                    u: up[k],
                    v: up[k] - k,
                };
            }
        }

        // reverse path
        for (k = kup - D; k <= kup + D; k += 2) {
            if (k === kup + D) {
                x = up[k - 1]; // up
            } else {
                x = up[k + 1] - 1; // left
                if ((k > kup - D) && (up[k - 1] < x)) {
                    x = up[k - 1]; // up
                }
            }
            y = x - k;

            while (x > astart && y > bstart && eql(a[x - 1], b[y - 1])) {
                x--; y--; // diagonal
            }
            up[k] = x;

            if (!deltaOdd && (kdown - D <= k) && (k <= kdown + D) &&
                up[k] <= down[k]) {
                return {
                    x: down[k],
                    y: down[k] - k,
                    u: up[k],
                    v: up[k] - k,
                };
            }
        }
    }
};

