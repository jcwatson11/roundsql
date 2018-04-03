'use strict';
const q = require('q');

/**
 * Model contains data and provides reflection and introspection into schema
 * from database.
 */
class Model {

        /**
         * Constructor for model
         * @param  {object} roundsql      [description]
         * @param  {array}  cols       [description]
         * @param  {string} tableName  [description]
         * @param  {string} modelName  [description]
         */
        constructor(roundsql,cols,tableName,modelName) {
            this.round = roundsql;
            this.mssql = this.round.mssql;
            this.connection = this.round.connection;
            this.debug = false;
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
        }


        /**
         * Sets the debug mode for roundsql. If bSetting is true, then queries and their
         * bindings will be output to the console.
         */
        setDebug(bSetting) {
            this.debug = bSetting;
        };

        /**
         * Hydrates this object with values provided.
         *
         * @param obj object with values to hydrate into this responder object
         */
        hydrate(obj,cols) {
            if(Array.isArray(obj)) {
                var ret = [];
                for(var i=0;i<obj.length;i++) {
                    var r = new Model(this.round,cols,this.tableName,this.modelName);
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
        }


        /**
         * Never create a new model any other way than using this method!
         *
         * @return new model instance
         */
        new() {
           return new Model(this.round,this.columns,this.tableName,this.modelName);
        }

        /**
         * Returns true if all of the columns in the where object are valid; false otherwise.
         *
         * @param where object following the format:
         *
         */
        whereIsValidForModel(where) {
            var result = this.round.whereIsValidForQuery(where);
            if(result !== true) return result;
            if( !this.columns ) {
                return "columns is "+typeof this.columns+".";
            }
            for(var i in where) {
                if(typeof this.columns[i] == 'undefined') {
                    return "Field "+i+" is not a valid field in the table schema.";
                }
            }
            return true;
        }

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
        addTypesToWhere(where) {
            for(var i in where) {
                if(!this.columns[i]) continue;
                where[i].type = this.columns[i].type;
            }
        }

        /**
         * Returns a promise that gets fulfilled with an array of Responder objects
         *
         * @param where object with property value pairs representing field names and values
         *        you want to serach for.
         * @return promise fulfilled with array of Responder objects
         */
        findAll(where, limit) {
            var deferred = q.defer();
            if(!where) where = {};
            this.addTypesToWhere(where);
            var result = this.whereIsValidForModel(where);
            if(result !== true ) {
                deferred.reject(result);
                return deferred.promise;
            }
            if(!limit) limit = 9;
            limit = parseInt(limit);
            var strWHERE = (Object.keys(where).length > 0) ? 'WHERE':'';
            var strSql = "SELECT TOP " +limit+ " * FROM ["+this.tableName+"] "+strWHERE+" " + this.round.parseWhere(where);

            // This also returns a promise. So let it.
            this.round.query(strSql,where).then(((deferred, results) => {
                var hydratedResults = this.hydrate(results,this.columns);
                deferred.resolve(hydratedResults);
            }).bind(this, deferred),((deferred, reason) => {
                deferred.reject(reason);
            }).bind(this, deferred));
            return deferred.promise;
        }

        /**
         * Returns an array of string field names from the columns array
         *
         * @param strPrefix string optional prefix to prefix each name with.
         *        Useful for creating binding parameter names
         * @return array of string column names
         */
        getInsertUpdateFieldNamesAsArray(strPrefix) {
            var ret = [];
            if(!strPrefix) strPrefix = '';
            for(var i in this.columns) {
                if(i == this.primaryKey) continue;
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
        getInsertUpdateParams(bUpdating,strNamePrefix) {
            var ret = {};
            for(var i in this.columns) {
                if(this.primaryKey == i) {
                    continue;
                }
                var strName = (typeof strNamePrefix != 'undefined') ? strNamePrefix+i:i;
                ret[strName] = {'value':this[i],'type':this.columns[i].type};
            }
            if(bUpdating) {
                ret[this.primaryKey] = {'value':this[this.primaryKey],'type':this.columns[this.primaryKey].type};
            }
            return ret;
        }

        /**
         * Returns a string SQL Insert statement for inserting this object.
         *
         * @return string INSERT statement.
         */
        getInsertQuery(bOmitSelectScopeIdentity,strParamPrefix) {
            var aFields   = this.getInsertUpdateFieldNamesAsArray();
            var strPrefix = '@';
            if(typeof strParamPrefix != 'undefined') strPrefix += strParamPrefix;
            var aBindings = this.getInsertUpdateFieldNamesAsArray(strPrefix);
            var strRet = "INSERT INTO ["
                +this.tableName
                +"] (["
                +aFields.join('],[')
                +"]) VALUES ("
                +aBindings.join(', ')
                +");\n";
                if(!bOmitSelectScopeIdentity) {
                    strRet += "SELECT SCOPE_IDENTITY() AS "+this.primaryKey+";\n";
                }
                return strRet;
        }

        /**
         * Returns a string SQL Update statement for inserting this object.
         *
         * @return string UPDATE statement
         */
        getUpdateQuery() {
            var aFields   = this.getInsertUpdateFieldNamesAsArray();
            var aBindings = this.getInsertUpdateFieldNamesAsArray('@');
            var strSql    = "UPDATE ["+this.tableName+"] SET ";
            var aSets     = [];
            for(var i=0;i<aFields.length;i++) {
                if(aFields[i] == this.primaryKey) continue;
                aSets.push("[" + aFields[i] + "] = " + aBindings[i]);
            }
            strSql += aSets.join(', ');
            strSql += " WHERE ["+this.primaryKey+"] = @" + this.primaryKey;
            return strSql;
        }

        /**
         * Ueses the table schema to generate INSERT and UPDATE statements for saving a record.
         *
         * @return promise fulfilled with a responder object.
         */
        save() {
            var deferred = q.defer();
            // INSERTING
            if(!this[this.primaryKey]) {
                var params = this.getInsertUpdateParams();
                var strSql = this.getInsertQuery();
                if(this.debug) {
                    console.log(strSql);
                    console.dir(params);
                }
                this.round.query(strSql,params).then(((deferred,results) => {
                    this[this.primaryKey] = results[0][this.primaryKey];
                    deferred.resolve(this);
                }).bind(this, deferred),((deferred, reason) => {
                    deferred.reject(reason);
                }).bind(this, deferred));
            // UPDATING
            } else {
                var params = this.getInsertUpdateParams(true);
                var strSql = this.getUpdateQuery();
                if(this.debug) {
                    console.log(strSql);
                    console.dir(params);
                }
                this.round.query(strSql,params).then(((deferred) => {
                    deferred.resolve(this);
                }).bind(this, deferred),((deferred, reason) => {
                    deferred.reject(reason);
                }).bind(this, deferred));
            }
            return deferred.promise;
        }

        /**
         * Deletes a record from the model's table in the database.
         *
         * @return promise that resolves to true
         * promise is rejected if the record has no primary key value
         */
        del() {
            var deferred = q.defer();
            if(!this[this.primaryKey]) {
                deferred.reject(this.modelName + " has no primary key value. Cannot delete.");
            } else {
                var strSql = "DELETE FROM " + this.tableName + " WHERE [" + this.primaryKey + "] = @" + this.primaryKey;
                var params = {};
                params[this.primaryKey] = {
                    'value':this[this.primaryKey]
                    ,'type':this.columns[this.primaryKey].type
                };
                this.round.query(strSql,params).then(((deferred) => {
                    this.RecordId = null;
                    deferred.resolve(true);
                }).bind(this, deferred),((deferred,reason) => {
                    deferred.reject(reason);
                }).bind(this,deferred));
            }
            return deferred.promise;
        }
    }
    module.exports = Model;
