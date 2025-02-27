var dbmap = {};

var closed_dbmap = {};

function echoStringValue(options) {
    return options[0].value
}

var SQL = null;

var sqlite3 = require('sqlite3');
if (!!sqlite3) {
    SQL = sqlite3.verbose();
} else {
    throw new Error('INTERNAL ERROR: sqlite3 not installed');
}

function openDatabase(options) {
    var name = options[0].name;

    if (!!dbmap[name]) throw new Error('INTERNAL OPEN ERROR: db already open for ' + name);

    // Support close-and-reopen tests
    if (!!closed_dbmap[name]) {
        var db = dbmap[name] = closed_dbmap[name];
        delete closed_dbmap[name];
        try {
            db.exec('ROLLBACK');
        } catch(e) { }
        return;
    }

    dbmap[name] = new SQL.Database(!!sqlite3 ? name : undefined);
}

async function backgroundExecuteSqlBatch(options) {
    var dbname = options[0].dbargs.dbname;

    if (!dbmap[dbname]) throw new Error('INTERNAL ERROR: database not open');

    var db = dbmap[dbname];

    var e = options[0].executes;

    var resultList = [];

    for (var i = 0; i < e.length; ++i) {
        var sql = e[i].sql;
        var params = e[i].params;

        if (!!sqlite3) {
            resultList.push(await _sqlite3ExecuteSql(db, sql, params));
        } else {
            var rr = []

            var prevTotalChanges = (db.exec('SELECT total_changes()'))[0].values[0][0];

            try {
                db.each(sql, params, function(r) {
                    rr.push(r);
                }, function() {
                    var insertId = (db.exec('SELECT last_insert_rowid()'))[0].values[0][0];
                    var totalChanges = (db.exec('SELECT total_changes()'))[0].values[0][0];
                    var rowsAffected = totalChanges - prevTotalChanges;
                    resultList.push({
                        type: 'success',
                        result: (rowsAffected !== 0) ? {
                            rows: rr,
                            insertId: insertId,
                            rowsAffected: rowsAffected
                        } : {
                            rows: rr,
                            rowsAffected: 0
                        }
                    });
                });
            } catch(e) {
                // FUTURE TODO: report correct error code according to Web SQL
                resultList.push({
                    type: 'error',
                    result: {
                        code: 0,
                        message: e.toString()
                    }
                });
            }
        }

    }

    return resultList;
}

function _sqlite3ExecuteSql(db, sql, params) {
    return new Promise(function (resolve) {
        var _sqlite3Handler = function (e, r) {
            if (e) {
                // FUTURE TODO: report correct error code according to SQLite3
                resolve({
                    type: 'error',
                    result: {
                        code: 0,
                        message: e.toString(),
                    },
                });
            } else {
                resolve({
                    type: 'success',
                    result:
                        this['changes'] && this['changes'] !== 0
                            ? {
                                rows: r,
                                insertId: this['lastID'],
                                rowsAffected: this['changes'],
                            }
                            : {
                                rows: r,
                                rowsAffected: 0,
                            },
                });
            }
        };
        if (sql.substr(0, 11) === 'INSERT INTO') {
            db.run(sql, params, _sqlite3Handler);
        } else {
            db.all(sql, params, _sqlite3Handler);
        }
    });
}

function closeDatabase(options) {
    var dbname = options[0].path;

    var db = dbmap[dbname];

    if (!db) throw new Error('INTERNAL CLOSE ERROR: database not open');

    // Keep in memory to support close-and-reopen tests
    closed_dbmap[dbname] = dbmap[dbname];

    delete dbmap[dbname];
}

function deleteDatabase(options) {
    var dbname = options[0].path;

    if (!!closed_dbmap[dbname]) {
        // XXX TBD causes test timeouts:
        // closed_dbmap[name].close();
        delete closed_dbmap[dbname];
        return;
    }

    var db = dbmap[dbname];

    if (!db)  throw new Error('INTERNAL DELETE ERROR');

    db.close();

    delete dbmap[dbname];
}

module.exports = {
    echoStringValue: echoStringValue,
    open: openDatabase,
    backgroundExecuteSqlBatch: backgroundExecuteSqlBatch,
    close: closeDatabase,
    delete: deleteDatabase
}
