'use strict';
const Model = require("./model.js");
const q = require('q');

/**
 * RoundSql class definition
 */
class RoundSql {

    constructor(mssql, connection) {
        this.mssql = mssql;
        this.connection = connection;
    }

    /**
     * Returns the SQL statemnet used to get column meta data while discovering the model.
     *
     * @table array of string table names or string single table name.
     *
     * @return string SQL statement used to get columns
     */
    getColumnsSql(table) {
        var strSql = "SELECT c.*, tc.CONSTRAINT_TYPE FROM INFORMATION_SCHEMA.COLUMNS c\n" +
                     " LEFT OUTER JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu\n" +
                     "    ON c.TABLE_NAME = ccu.TABLE_NAME\n" +
                     "    AND ccu.COLUMN_NAME = c.COLUMN_NAME\n" +
                     " LEFT OUTER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc\n" +
                     "    ON c.TABLE_NAME = tc.TABLE_NAME\n" +
                     "    AND tc.CONSTRAINT_NAME = ccu.CONSTRAINT_NAME \n" +
                     " WHERE\n" +
                     "    c.TABLE_NAME \n";
        if(Array.isArray(table)) {
            strSql += ' IN (\'' + table.join('\',\'') + '\')';
        } else {
            strSql += ' = N\''+table+'\'';
        }
        return strSql;
    }

    /**
     * Returns a promise that gets fulfilled with a recordset full of table column details.
     *
     * @param table array of string table names or string table name
     * @return promise fulfilled with recordset of table column detail rows
     */
    getColumns(table) {
        var strSql = this.getColumnsSql(table);
        return this.query(strSql);
    }

    /**
     * Validate stored proc parameters before we send them to the stored proc
     *
     * @param params array of input values we want to validate
     * @param defs array of stored procedure parameter definitions from the database.
     * @return boolean true if the parameters are valid for the stored procedure.
     */
    procParamsAreValid(params,defs) {
        if(params.length != defs.length) return false;
        return true;
    }


    /**
     * Convert stored proc values to an array of objects with the value and data type
     * so we can use it to put together a stored procedure.
     *
     * @params array of scalar values to be used as parameter values
     * @defs array of stored proc parameter definitions from database
     * @return array of objects in format {'name':'PARAM_NAME','value':'somevalue','type':TYPE}
     *         where TYPE is an mssql native type enum value
     *         and PARAM_NAME is the name of the parameter according to the proc
     *         definition in the database
     */
    convertProcValuesToParams(params, defs) {
        var ret = [];
        // insure parameter definitions are sorted by parameter order.
        defs = defs.sort(function(a, b) {
            return a.ORDER - b.ORDER;
        });
        for(var i=0;i<params.length;i++) {
            var p = {'name':defs[i].COLUMN_NAME,'value':params[i],'type':this.getSqlServerNativeDataType(defs[i])};
            ret.push(p);
        }
        return ret;
    }

    /**
     * Execute a stored procedure and return a promise that resolves with the results and the
     * return value.
     *
     * @param procName string stored procedure name
     * @param args array of argument values to be passed to the stored procedure
     *
     * @return promise that resolves with results and return value as its 2 parameters.
     */
    proc(procName, args) {
        var deferred = q.defer();
        this.getStoredProcParameters(procName).then(((deferred, args, defs) => {
            if(!this.procParamsAreValid(args,defs)) {
                deferred.reject('PROC ERROR: Could not execute. Parameters are not valid.');
            }
            var params = this.convertProcValuesToParams(args,defs);
            var request = new this.mssql.Request(this.connection);
            for(var i=0;i<params.length;i++) {
                request.input(params[i].name.replace(/\@/,''), params[i].type, params[i].value);
            }
            request.execute(procName).then(function(ret) {
                deferred.resolve([ret]);
            },function(reason) {
                deferred.reject(reason);
            });
        }).bind(this,deferred,args),((deferred,reason) => {
            deferred.reject(reason);
        }).bind(this,deferred));
        return deferred.promise;
    }

    /**
     * Returns a promise that is fulfilled with an array of rows defining
     * stored procedure parameters
     *
     * @param name string stored procedure name in format [dbo].[ProcName]
     * @return promise
     */
    getStoredProcParameters(name) {
        var strSql = "select" +
        "   'COLUMN_NAME' = name," +
        "   'DATA_TYPE'   = type_name(user_type_id)," +
        "   'CHARACTER_MAXIMUM_LENGTH'   = max_length," +
        "   'NUMERIC_PRECISION'   = case when type_name(system_type_id) = 'uniqueidentifier'" +
        "              then precision" +
        "              else OdbcPrec(system_type_id, max_length, precision) end," +
        "   'NUMERIC_SCALE'   = OdbcScale(system_type_id, scale)," +
        "   'ORDER'  = parameter_id," +
        "   'COLLATION_NAME'   = convert(sysname," +
        "                   case when system_type_id in (35, 99, 167, 175, 231, 239)" +
        "                   then ServerProperty('collation') end)" +
        "  from sys.parameters where object_id = object_id('"+name+"')";
        return this.query(strSql);
    }

    /**
     * Parses a query given a set of where clauses.
     *
     * @param where object with fieldname properties and object values like so:
     * {
     *     'FirstName': {value:'Jon'}
     *     ,'LastName': {operator: '<>', value:'Watson'}
     * }
     */
    parseWhere(where) {
        var aClauses = [];
        for(var i in where) {
            var strOperator = '=';
            if(where[i].operator) {
                strOperator = where[i].operator;
            }
            aClauses.push("["+i+"] "+strOperator+" @" + i);
        }
        return aClauses.join(' AND ');
    }

    /**
     * Calls ps.input() for each where parameter so data can be bound in the prepared statement.
     *
     * @param ps instance of mssql.PreparedStatement
     * @where object following standard where clause structure:
     * {
     *     'FirstName': {value:'Jon'}
     *     ,'LastName': {operator: '<>', value:'Watson'}
     * }
     * @return void
     */
    setPreparedStatementInputs(ps,where) {
        if(where === null) return;
        for(var i in where) {
            ps.input(i,where[i].type);
        }
    }

    /**
     * Translates a standard where object into a simpler one used in prepared statements
     *
     * @param where standard where object following the format:
     * {
     *     'FirstName': {value:'Jon'}
     *     ,'LastName': {operator: '<>', value:'Watson'}
     * }
     * @return simpler where format:
     * {
     *     'FirstName': 'Jon'
     *     ,'LastName': 'Watson'
     * }
     */
    getWhereForPreparedStatement(where) {
        if(where === null) return {};
        var w = {};
        for(var i in where)
            w[i] = where[i].value;
        return w;
    }

    /**
     * If the error is not null, then the connection, if it is a transaction,
     * is rolled back and the promise is rejected with the transaction error message
     * as the reason string.
     *
     * If the error is not null, but the connection is not a transaction,
     * the promise is rejected with the error message as the reason string.
     */
    dbHadError(err,deferred) {
        if(err) {
            deferred.reject(err.message);
            return true;
        }
        return false;
    }

    /**
     * Returns the session ID for 'DDAPI'
     *
     * @return promise that resolves with an integer sessionID
     */
    getSessionId() {
        var deferred = q.defer();
        var request = new this.mssql.Request(this.connection);
        var work = () => {
            request.input('User', this.mssql.VarChar(200),'DDAPI');
            request.input('DatabaseId',this.mssql.VarChar(10),'DEV');
            request.input('AccessorSource',this.mssql.VarChar(10),'I');
            request.execute('X29_CreateNewAccessorSession',((deferred,err,resultsets,returnValue) => {
                if(this.dbHadError(err,deferred,this.connection)) return;
                var sessionId = parseInt(resultsets[0][0]['']);
                deferred.resolve(sessionId);
            }).bind(this, deferred));
        };
        work();
        return deferred.promise;
    }

    whereIsValidForQuery(where) {
        for(var i in where) {
            if( where[i] !== null && typeof where[i] != 'object') {
                return "value of where."+i+" is not an object";
            }
            var keys = Object.keys(where[i]);
            if(keys.indexOf('value') == -1) {
                return "Where clause "+i+" does not have a value property.";
            }
            if(keys.indexOf('type') == -1) {
                return "Where clause "+i+" does not have a type property.";
            }
        }
        return true;
    }

    /**
     * Execute a query with bound parameters. If there are no bound parameters,
     * the query will be run without a prepared statement.
     *
     * @param strQuery string query
     * @param params standard parameters array in the format:
     * {
     *     'FirstName': {value:'Jon'}
     *     ,'LastName': {operator: '<>', value:'Watson'}
     * }
     * @return promise fulfilled with recordset from query
     */
    query(strSql,params) {
        var deferred = q.defer();
        var result = this.whereIsValidForQuery(params);
        if(result !== true ) {
            deferred.reject(result);
            return deferred.promise;
        }
        var psWhere = this.getWhereForPreparedStatement(params);
        // If there are bound parameters, the query should be prepared and
        // executed.
        if(Object.keys(psWhere).length > 0) {
            this.runPreparedStatement(strSql, params, psWhere, deferred);
        } else {
            this.runSimpleQuery(strSql, deferred);
        }
        return deferred.promise;
    }

    /**
     * Helper for query() function
     * Runs a simple query with no bindings and resolves
     * @param  {[type]} strSql   [description]
     * @param  {[type]} deferred [description]
     * @return {[type]}          [description]
     */
    runSimpleQuery(strSql, deferred) {
        var request = new this.mssql.Request(this.connection);
        request.query(strSql)
        .then((recordset) => {
            if(recordset && recordset.length > 0) {
                deferred.resolve(recordset);
            } else {
                deferred.resolve(request.rowsAffected);
            }
        },deferred.reject)
        .catch(deferred.reject);
    }

    runPreparedStatement(strSql, params, bindings, deferred) {
        var ps = new this.mssql.PreparedStatement(this.connection);
        this.setPreparedStatementInputs(ps,params);
        ps.prepare(strSql).then(
            ((deferred) => {
            ps.execute(bindings,((deferred, err, recordset) => {
                if(err) {
                    deferred.reject(err.message);
                } else {
                    deferred.resolve(recordset);
                }
            }).bind(this, deferred));
            ps.unprepare();
        }).bind(this, deferred),((deferred, reason) => {
            deferred.reject(reason);
        }).bind(this, deferred));
    }

    /**
     * Returns the mssql native SQL Server data type for a given column definition.
     *
     * @coldef object representing a row from INFORMATION_SCHEMA
     * @return mssql.NativeType where NativeType is one of the mssql native types.
     */
    getSqlServerNativeDataType(coldef) {
        switch(coldef.DATA_TYPE) {
            case 'varchar':
                if(coldef.CHARACTER_MAXIMUM_LENGTH == -1) {
                    return this.mssql.VarChar(this.mssql.MAX);
                }
                return this.mssql.VarChar(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'nvarchar':
                if(coldef.CHARACTER_MAXIMUM_LENGTH == -1) {
                    return this.mssql.NVarChar(this.mssql.MAX);
                }
                return this.mssql.NVarChar(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'char':
                return this.mssql.Char(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'bigint':
                return this.mssql.BigInt;
            case 'int':
                return this.mssql.Int;
            case 'tinyint':
                return this.mssql.TinyInt;
            case 'bit':
                return this.mssql.Bit;
            case 'real':
                return this.mssql.Real;
            case 'image':
                return this.mssql.Image;
            case 'smallmoney':
                return this.mssql.SmallMoney;
            case 'money':
                return this.mssql.Money;
            case 'decimal':
                return this.mssql.Decimal(parseInt(coldef.NUMERIC_PRECISION), parseInt(coldef.NUMERIC_SCALE));
            case 'varbinary':
                if(coldef.CHARACTER_MAXIMUM_LENGTH == -1) {
                    return this.mssql.VarBinary(this.mssql.MAX);
                }
                return this.mssql.VarBinary(parseInt(coldef.CHARACTER_OCTET_LENGTH));
            case 'smallint':
                return this.mssql.SmallInt;
            case 'smalldatetime':
                return this.mssql.NVarChar(30);
            case 'datetime':
                return this.mssql.NVarChar(30);
            case 'datetime2':
                return this.mssql.NVarChar(30);
            case 'time':
                return this.mssql.Time(parseInt(coldef.NUMERIC_SCALE));
            case 'datetimeoffset':
                return this.mssql.DateTimeOffset(parseInt(coldef.NUMERIC_SCALE));
            case 'numeric':
                return this.mssql.Numeric(parseInt(coldef.NUMERIC_PRECISION), parseInt(coldef.NUMERIC_SCALE));
            case 'uniqueidentifier':
                return this.mssql.UniqueIdentifier;
            case 'nchar':
                return this.mssql.NChar(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'float':
                return this.mssql.Float;
            case 'date':
                return this.mssql.NVarChar(30);
            case 'text':
                return this.mssql.Text;
            case 'ntext':
                return this.mssql.NText;
            case 'xml':
                return this.mssql.Xml;
            case 'udt':
                return this.mssql.UDT;
            case 'geography':
                return this.mssql.Geography;
            case 'geometry':
                return this.mssql.Geometry;
            default:
                return "Unrecognized data type " + coldef.DATA_TYPE;
        }
    }

    /**
     * Translates the rather over-complex output from INFORMATION_SCHEMA
     * into the much more manageable and simple format:
     * {'FieldName': nativeType, 'AnotherFieldName': anotherNativeType}
     *
     * @param columns array of objects representing the output from the INFORMATION_SCHEMA
     *        table for a given table.
     * @return object with fieldname properties and datatype values.
     */
    translateColumns(cols) {
        var ret = {};
        for(var i=0;i<cols.length;i++) {
            var strName = cols[i].COLUMN_NAME
            var type = this.getSqlServerNativeDataType(cols[i]);
            ret[strName] = {'type':type,'primaryKey':cols[i].CONSTRAINT_TYPE == 'PRIMARY KEY'};
        }
        return ret;
    }

    /**
     * Generates a new model from the information provided.
     * @param  {string} tableName [description]
     * @param  {string} modelName [description]
     * @param  {object} columns   [description]
     * @return {object} Model
     */
    generateModel(tableName, modelName, columns) {
        return new Model(this,columns,tableName,modelName);
    }


    /**
     * Returns a promise that gets fulfilled with a newly generated model
     *
     * @param tableName name of table to discover model from
     * @param modelName name of the model you want to create
     * @return promise that gets fulfilled with a discovered/generated model
     */
    discoverModel(tableName, modelName) {
        var deferred = q.defer();
        var models = [];
        this.getColumns(tableName).then(((deferred,models,cols) => {
            if(cols.length == 0) {
                deferred.reject('No column data returned for table ['+tableName+']. Perhaps you misspelled the name of the table?');
                return;
            }
            var translatedColumns = this.translateColumns(cols);
            if(Array.isArray(tableName)) {
                if(!Array.isArray(modelName)) {
                    deferred.reject("If argument 1 (tableNames) is an array, then argument 2 (modelNames) must also be an array.");
                    return;
                }
                for(var i=0;i<tableName.length;i++) {
                    models[modelName[i]] = this.generateModel(tableName[i], modelName[i], translatedColumns);
                }
            } else {
                if(Array.isArray(modelName)) {
                    deferred.reject("If argument 1 (tableName) is a string, then argument 2 (modelName) must also be a string.");
                    return;
                }
                models[modelName] = this.generateModel(tableName, modelName, translatedColumns);
            }
            deferred.resolve(models);
        }).bind(this, deferred, models),function(reason) {
            deferred.reject(reason);
        });
        return deferred.promise;
    }

}
module.exports = RoundSql;
