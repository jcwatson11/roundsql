module.exports = function roundsql(mssql,connection) {

    /**
     * Using promises
     */
    var q   = require('q');

    /**
     * Returns the SQL statemnet used to get column meta data while discovering the model.
     *
     * @table array of string table names or string single table name.
     *
     * @return string SQL statement used to get columns
     */
    var getColumnsSql = function(table) {
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
    };
    this.getColumnsSql = getColumnsSql;

    /**
     * Returns a promise that gets fulfilled with a recordset full of table column details.
     *
     * @param table array of string table names or string table name
     * @return promise fulfilled with recordset of table column detail rows
     */
    var getColumns = function(table) {
        strSql = getColumnsSql(table);
        return query(strSql);
    };
    this.getColumns = getColumns;

    /**
     * Validate stored proc parameters before we send them to the stored proc
     *
     * @param params array of input values we want to validate
     * @param defs array of stored procedure parameter definitions from the database.
     * @return boolean true if the parameters are valid for the stored procedure.
     */
    var procParamsAreValid = function(params,defs) {
        if(params.length != defs.length) return false;
        return true;
    };

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
    var convertProcValuesToParams = function(params, defs) {
        var ret = [];
        // insure parameter definitions are sorted by parameter order.
        defs = defs.sort(function(a, b) {
            return a.ORDER - b.ORDER;
        });
        for(var i=0;i<params.length;i++) {
            var p = {'name':defs[i].COLUMN_NAME,'value':params[i],'type':getSqlServerNativeDataType(defs[i])};
            ret.push(p);
        }
        return ret;
    };

    /**
     * Execute a stored procedure and return a promise that resolves with the results and the
     * return value.
     *
     * @param procName string stored procedure name
     * @param args array of argument values to be passed to the stored procedure
     *
     * @return promise that resolves with results and return value as its 2 parameters.
     */
    var proc = function(procName, args) {
        var deferred = q.defer();
        getStoredProcParameters(procName).then(
        function(defs) {
            if(!procParamsAreValid(args,defs)) {
                deferred.reject('PROC ERROR: Could not execute. Parameters are not valid.');
            }
            var params = convertProcValuesToParams(args,defs);
            var request = new mssql.Request(connection);
            for(var i=0;i<params.length;i++) {
                request.input(params[i].name.replace(/\@/,''), params[i].type, params[i].value);
            }
            request.execute(procName).then(function(ret) {
                deferred.resolve([ret]);
            },function(reason) {
                deferred.reject(reason);
            });
        },function(reason) {
            deferred.reject(reason);
        });
        return deferred.promise;
    };
    this.proc = proc;

    /**
     * Returns a promise that is fulfilled with an array of rows defining
     * stored procedure parameters
     *
     * @param name string stored procedure name in format [dbo].[ProcName]
     * @return promise
     */
    var getStoredProcParameters = function(name) {
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
        return query(strSql);
    };
    this.getStoredProcParameters = getStoredProcParameters;

    /**
     * Parses a query given a set of where clauses.
     *
     * @param where object with fieldname properties and object values like so:
     * {
     *     'FirstName': {value:'Jon'}
     *     ,'LastName': {operator: '<>', value:'Watson'}
     * }
     */
    this.parseWhere = function(where) {
        var aClauses = [];
        for(var i in where) {
            var strOperator = '=';
            if(typeof where[i].value == 'undefined')
            {
                deferred.reject("The where clause must have a value. Example: {'FirstName': { 'value': 'Jonathan' } }. Your object was: " + JSON.stringify(where));
            }
            if(where[i].operator) {
                strOperator = where[i].operator;
            }
            aClauses.push("["+i+"] "+strOperator+" @" + i);
        }
        return aClauses.join(' AND ');
    };

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
    var setPreparedStatementInputs = function(ps,where) {
        if(where === null) return;
        for(var i in where) {
            ps.input(i,where[i].type);
        }
    };
    this.setPreparedStatementInputs = setPreparedStatementInputs;

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
    var getWhereForPreparedStatement = function(where) {
        if(where === null) return {};
        var w = {};
        for(var i in where)
            w[i] = where[i].value;
        return w;
    };
    this.getWhereForPreparedStatement = getWhereForPreparedStatement;

    /**
     * If the error is not null, then the connection, if it is a transaction,
     * is rolled back and the promise is rejected with the transaction error message
     * as the reason string.
     * 
     * If the error is not null, but the connection is not a transaction,
     * the promise is rejected with the error message as the reason string.
     */
    var dbHadError = function(err,deferred) {
        if(err) {
            deferred.reject(err.message);
            return true;
        }
        return false;
    }
    this.dbHadError = dbHadError;

    /**
     * Returns the session ID for 'DDAPI'
     *
     * @return promise that resolves with an integer sessionID
     */
    this.getSessionId = function() {
        var deferred = q.defer();
        var request = new mssql.Request(connection);
        var work = function() {
            request.input('User', mssql.VarChar(200),'DDAPI');
            request.input('DatabaseId',mssql.VarChar(10),'DEV');
            request.input('AccessorSource',mssql.VarChar(10),'I');
            request.execute('X29_CreateNewAccessorSession',function(err,resultsets,returnValue) {
                if(dbHadError(err,deferred,connection)) return;
                var sessionId = parseInt(resultsets[0][0]['']);
                deferred.resolve(sessionId);
            });
        };
        work();
        return deferred.promise;
    };

    var whereIsValidForQuery = function(where) {
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
    };
    this.whereIsValidForQuery = whereIsValidForQuery;

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
    var query = function(strSql,params) {
        var deferred = q.defer();
        var result = whereIsValidForQuery(params);
        if(result !== true ) {
            deferred.reject(result);
            return deferred.promise;
        }
        var ps = new mssql.PreparedStatement(connection);
        setPreparedStatementInputs(ps,params);
        var psWhere = getWhereForPreparedStatement(params);
        ps.prepare(strSql).then(function() {
            ps.execute(psWhere,function(err,recordset) {
                if(err) {
                    deferred.reject(err.message);
                } else {
                    deferred.resolve(recordset);
                }
            });
            ps.unprepare();
        },function(reason) {
            deferred.reject(reason);
        });
        return deferred.promise;
    };
    this.query = query;

    /**
     * Returns the mssql native SQL Server data type for a given column definition.
     *
     * @coldef object representing a row from INFORMATION_SCHEMA
     * @return mssql.NativeType where NativeType is one of the mssql native types.
     */
    var getSqlServerNativeDataType = function(coldef) {
        switch(coldef.DATA_TYPE) {
            case 'varchar':
                if(coldef.CHARACTER_MAXIMUM_LENGTH == -1) {
                    return mssql.VarChar(mssql.MAX);
                }
                return mssql.VarChar(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'nvarchar':
                if(coldef.CHARACTER_MAXIMUM_LENGTH == -1) {
                    return mssql.NVarChar(mssql.MAX);
                }
                return mssql.NVarChar(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'char':
                return mssql.Char(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'bigint':
                return mssql.BigInt;
            case 'int':
                return mssql.Int;
            case 'tinyint':
                return mssql.TinyInt;
            case 'bit':
                return mssql.Bit;
            case 'real':
                return mssql.Real;
            case 'image':
                return mssql.Image;
            case 'smallmoney':
                return mssql.SmallMoney;
            case 'money':
                return mssql.Money;
            case 'decimal':
                return mssql.Decimal(parseInt(coldef.NUMERIC_PRECISION), parseInt(coldef.NUMERIC_SCALE));
            case 'varbinary':
                if(coldef.CHARACTER_MAXIMUM_LENGTH == -1) {
                    return mssql.VarBinary(mssql.MAX);
                }
                return mssql.VarBinary(parseInt(coldef.CHARACTER_OCTET_LENGTH));
            case 'smallint':
                return mssql.SmallInt;
            case 'smalldatetime':
                return mssql.SmallDateTime;
            case 'datetime':
                return mssql.DateTime;
            case 'datetime2':
                return mssql.DateTime2(parseInt(coldef.NUMERIC_SCALE));
            case 'time':
                return mssql.Time(parseInt(coldef.NUMERIC_SCALE));
            case 'datetimeoffset':
                return mssql.DateTimeOffset(parseInt(coldef.NUMERIC_SCALE));
            case 'numeric':
                return mssql.Numeric(parseInt(coldef.NUMERIC_PRECISION), parseInt(coldef.NUMERIC_SCALE));
            case 'uniqueidentifier':
                return mssql.UniqueIdentifier;
            case 'nchar':
                return mssql.NChar(parseInt(coldef.CHARACTER_MAXIMUM_LENGTH));
            case 'float':
                return mssql.Float;
            case 'date':
                return mssql.Date;
            case 'text':
                return mssql.Text;
            case 'ntext':
                return mssql.NText;
            case 'xml':
                return mssql.Xml;
            case 'udt':
                return mssql.UDT;
            case 'geography':
                return mssql.Geography;
            case 'geometry':
                return mssql.Geometry;
            default:
                return "Unrecognized data type " + coldef.DATA_TYPE;
        }
    };
    this.getSqlServerNativeDataType = getSqlServerNativeDataType;

    /**
     * Translates the rather over-complex output from INFORMATION_SCHEMA
     * into the much more manageable and simple format:
     * {'FieldName': nativeType, 'AnotherFieldName': anotherNativeType}
     *
     * @param columns array of objects representing the output from the INFORMATION_SCHEMA
     *        table for a given table.
     * @return object with fieldname properties and datatype values.
     */
    var translateColumns = function(cols) {
        var ret = {};
        for(var i=0;i<cols.length;i++) {
            var strName = cols[i].COLUMN_NAME
            var type = getSqlServerNativeDataType(cols[i]);
            ret[strName] = {'type':type,'primaryKey':cols[i].CONSTRAINT_TYPE == 'PRIMARY KEY'};
        }
        return ret;
    };
    this.translateColumns = translateColumns;


    var modelConstructor = function(connection,cols,tableName,modelName) {

        this.debug = false;

        /**
         * Sets the debug mode for roundsql. If bSetting is true, then queries and their
         * bindings will be output to the console.
         */
        this.setDebug = function(bSetting) {
            self.debug = bSetting;
        };

        this.tableName = tableName;
        this.modelName = modelName;

        this.columns = cols;

        this.primaryKey = null;

        for(var i in cols) {
            this[i] = null;
            if(cols[i].primaryKey) {
                this.primaryKey = i;
            }
        }

        var self = this;

        /**
         * Reference to roundsql instance for help.
         */
        var round = new roundsql(mssql,connection);

        /**
         * Hydrates this object with values provided.
         *
         * @param obj object with values to hydrate into this responder object
         */
        var hydrate = function(obj,cols) {
            if(Array.isArray(obj)) {
                var ret = [];
                for(var i=0;i<obj.length;i++) {
                    var r = new modelConstructor(connection,cols,self.tableName,self.modelName);
                    r.hydrate(obj[i],cols);
                    ret.push(r);
                }
                return ret;
            } else {
                for(var i in obj) {
                    this[i] = obj[i];
                }
                return this;
            }
        };
        this.hydrate = hydrate;


        /**
         * Never create a new model any other way than using this method!
         *
         * @return new model instance
         */
        this.new = function() {
            var ret = new modelConstructor(connection,cols,self.tableName,self.modelName);
            return ret;
        };

        /**
         * Returns true if all of the columns in the where object are valid; false otherwise.
         *
         * @param where object following the format:
         *
         */
        var whereIsValidForModel = function(where) {
            var result = whereIsValidForQuery(where);
            if(result !== true) return result;
            if( !cols ) {
                return "columns is "+typeof cols+".";
            }
            for(var i in where) {
                if(typeof cols[i] == 'undefined') {
                    return "Field "+i+" is not a valid field in the table schema.";
                }
            }
            return true;
        };
        this.whereIsValidForModel = whereIsValidForModel;

        /**
         * In order for the prepared statement process to work, all parameters must have
         * a type. Luckily, we should already have column data by this point to tell us
         * what type to use.
         *
         * @param where object defining parameters in format:
         * {
         *     'FirstName': {value:'Jon'}
         *     ,'LastName': {operator: '<>', value:'Watson'}
         * }
         */
        var addTypesToWhere = function(where) {
            for(var i in where) {
                if(!cols[i]) continue;
                where[i].type = cols[i].type;
            }
        };
        this.addTypesToWhere = addTypesToWhere;

        /**
         * Returns a promise that gets fulfilled with an array of Responder objects
         *
         * @param where object with property value pairs representing field names and values
         *        you want to serach for.
         * @return promise fulfilled with array of Responder objects
         */
        var findAll = function(where, limit) {
            var deferred = q.defer();
            if(!where) where = {};
            addTypesToWhere(where);
            var result = whereIsValidForModel(where);
            if(result !== true ) {
                deferred.reject(result);
                return deferred.promise;
            }
            if(!limit) limit = 10;
            limit = parseInt(limit);
            var strWHERE = (Object.keys(where).length > 0) ? 'WHERE':'';
            var strSql = "SELECT TOP " +limit+ " * FROM ["+self.tableName+"] "+strWHERE+" " + round.parseWhere(where);

            // This also returns a promise. So let it.
            round.query(strSql,where).then(function(results) {
                var hydratedResults = hydrate(results,cols);
                deferred.resolve(hydratedResults);
            },function(reason) {
                deferred.reject(reason);
            });
            return deferred.promise;
        };
        this.findAll = findAll;

        /**
         * Returns an array of string field names from the columns array
         *
         * @param strPrefix string optional prefix to prefix each name with.
         *        Useful for creating binding parameter names
         * @return array of string column names
         */
        function getInsertUpdateFieldNamesAsArray(strPrefix) {
            var ret = [];
            if(!strPrefix) strPrefix = '';
            for(var i in cols) {
                if(i == self.primaryKey) continue;
                ret.push(strPrefix + i);
            }
            return ret;
        }

        /**
         * Returns an array of objects suitable for use in creating insert/update
         * statements
         *
         * @return array of objects with format:
         *    {'value':'SomeValue','type':TYPE}
         *    where TYPE is the mssql native data type.
         */
        var getInsertUpdateParams = function(bUpdating,strNamePrefix) {
            var ret = {};
            for(var i in cols) {
                if(self.primaryKey == i) {
                    continue;
                }
                var strName = (typeof strNamePrefix != 'undefined') ? strNamePrefix+i:i;
                ret[strName] = {'value':self[i],'type':cols[i].type};
            }
            if(bUpdating) {
                ret[this.primaryKey] = {'value':self[this.primaryKey],'type':cols[self.primaryKey].type};
            }
            return ret;
        };
        this.getInsertUpdateParams = getInsertUpdateParams;

        /**
         * Returns a string SQL Insert statement for inserting this object.
         *
         * @return string INSERT statement.
         */
        var getInsertQuery = function(bOmitSelectScopeIdentity,strParamPrefix) {
            var aFields   = getInsertUpdateFieldNamesAsArray();
            var strPrefix = '@';
            if(typeof strParamPrefix != 'undefined') strPrefix += strParamPrefix;
            var aBindings = getInsertUpdateFieldNamesAsArray(strPrefix);
            var strRet = "INSERT INTO ["
                +self.tableName
                +"] (["
                +aFields.join('],[')
                +"]) VALUES ("
                +aBindings.join(', ')
                +");\n";
                if(!bOmitSelectScopeIdentity) {
                    strRet += "SELECT SCOPE_IDENTITY() AS "+self.primaryKey+";\n";
                }
                return strRet;
        };
        this.getInsertQuery = getInsertQuery;

        /**
         * Returns a string SQL Update statement for inserting this object.
         *
         * @return string UPDATE statement
         */
        var getUpdateQuery = function() {
            var aFields   = getInsertUpdateFieldNamesAsArray();
            var aBindings = getInsertUpdateFieldNamesAsArray('@');
            var strSql    = "UPDATE ["+self.tableName+"] SET ";
            var aSets     = [];
            for(var i=0;i<aFields.length;i++) {
                if(aFields[i] == this.primaryKey) continue;
                aSets.push("[" + aFields[i] + "] = " + aBindings[i]);
            }
            strSql += aSets.join(', ');
            strSql += " WHERE ["+this.primaryKey+"] = @" + this.primaryKey;
            return strSql;
        };
        this.getUpdateQuery = getUpdateQuery;

        /**
         * Ueses the table schema to generate INSERT and UPDATE statements for saving a record.
         *
         * @return promise fulfilled with a responder object.
         */
        var save = function() {
            var deferred = q.defer();
            // INSERTING
            if(!this[this.primaryKey]) {
                var params = getInsertUpdateParams();
                var strSql = getInsertQuery();
                if(self.debug) {
                    console.log(strSql);
                    console.dir(params);
                }
                query(strSql,params).then(function(results) {
                    self[self.primaryKey] = results[0][self.primaryKey];
                    deferred.resolve(self);
                },function(reason) {
                    deferred.reject(reason);
                });
            // UPDATING
            } else {
                var params = getInsertUpdateParams(true);
                var strSql = getUpdateQuery();
                if(self.debug) {
                    console.log(strSql);
                    console.dir(params);
                }
                query(strSql,params).then(function() {
                    deferred.resolve(self);
                },function(reason) {
                    deferred.reject(reason);
                });
            }
            return deferred.promise;
        };
        this.save = save;

        /**
         * Deletes a record from the model's table in the database.
         *
         * @return promise that resolves to true
         * promise is rejected if the record has no primary key value
         */
        var del = function() {
            var deferred = q.defer();
            if(!self[this.primaryKey]) {
                deferred.reject(this.modelName + " has no primary key value. Cannot delete.");
            } else {
                var strSql = "DELETE FROM " + self.tableName + " WHERE [" + self.primaryKey + "] = @" + self.primaryKey;
                var params = {};
                params[self.primaryKey] = {
                    'value':self[self.primaryKey]
                    ,'type':cols[self.primaryKey].type
                };
                query(strSql,params).then(function() {
                    self.RecordId = null;
                    deferred.resolve(true);
                },function(reason) {
                    deferred.reject(reason);
                });
            }
            return deferred.promise;
        };
        this.delete = del;

    };
    this.modelConstructor = modelConstructor;

    var generateModel = function(tableName, modelName, config, columns) {
        return new modelConstructor(connection,columns,tableName,modelName);
    };
    this.generateModel = generateModel;


    /**
     * Returns a promise that gets fulfilled with a newly generated model
     *
     * @param tableName name of table to discover model from
     * @param modelName name of the model you want to create
     * @config object with configuration parameters
     * @return promise that gets fulfilled with a discovered/generated model
     */
    var discoverModel = function(tableName, modelName, config) {
        var deferred = q.defer();
        var models = [];
        getColumns(tableName).then(function(cols) {
            if(cols.length == 0) {
                deferred.reject('No column data returned for table ['+tableName+']. Perhaps you misspelled the name of the table?');
                return;
            }
            var translatedColumns = translateColumns(cols);
            if(Array.isArray(tableName)) {
                if(!Array.isArray(modelName)) {
                    deferred.reject("If argument 1 (tableNames) is an array, then argument 2 (modelNames) must also be an array.");
                    return;
                }
                for(var i=0;i<tableName.length;i++) {
                    models[modelName[i]] = generateModel(tableName[i], modelName[i], config, translatedColumns);
                }
            } else {
                if(Array.isArray(modelName)) {
                    deferred.reject("If argument 1 (tableName) is a string, then argument 2 (modelName) must also be a string.");
                    return;
                }
                models[modelName] = generateModel(tableName, modelName, config, translatedColumns);
            }
            deferred.resolve(models);
        },function(reason) {
            deferred.reject(reason);
        });
        return deferred.promise;
    };
    this.discoverModel = discoverModel;

};

