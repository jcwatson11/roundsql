'use strict';
var mssql       = require('mssql');
var jasminUtils = require('jasmine-utils');
var RoundSql    = require('../roundsql.js');
var Model       = require('../model.js');

describe('after connecting,', function() {

    describe('when using roundsql,',function() {

        var connection = { connected: false };
        var transaction = { connected: false };
        var begun = false;
        var round;
        var config = {
            user: process.env.DMS_US_USER
           ,password: process.env.DMS_US_PASS
           ,server: process.env.DMS_US_HOST
           ,database: process.env.DMS_US_DBNAME
           ,port: process.env.DMS_US_PORT
        };


        beforeAll(function(done) {
            connection = new mssql.Connection(config,function(err) {
                if(err) {
                    console.log('CONNECTION ERR: ' + err.message);
                }
                transaction = new mssql.Transaction(connection);
                round = new RoundSql(mssql,transaction);
                transaction.begin().then(function() {
                    begun = true;
                    done();
                },function(reason) {
                    console.log('TRANSACTION NOT BEGUN: ', reason);
                    done();
                });
            });
        });

        it('it gets native data types from text types',function() {
            var coldef = { COLUMN_NAME: 'Status', DATA_TYPE: 'char', CHARACTER_MAXIMUM_LENGTH: 1 };
            var type = round.getSqlServerNativeDataType(coldef);
            expect(type).toEqual(mssql.Char(1));

            coldef = { COLUMN_NAME: 'Status', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 20 };
            type = round.getSqlServerNativeDataType(coldef);
            expect(type).toEqual(mssql.VarChar(20));
        });

        it('it executes a stored procedure and gets the result',function(done) {
            if(begun) {
                var args = ['DDAPI','DEV','I'];
                round.proc('X29_CreateNewAccessorSession',args)
                .then(function(rets) {
                    var results = rets[0];
                    var returnValue = rets[0]['returnValue'];
                    expect(results[0][0]['']).toBeInteger();
                    expect(returnValue).toBeInteger();
                    done();
                },function(reason) {
                    console.log('ERROR: PROC FAILED: X29_CreateNewAccessorSession: ', reason);
                    done();
                });
            }
        });

        it('it can parse a where query properly.',function() {
            var where = {
                'FirstName': {'value': 'Jonathan'}
                ,'LastName': {'value': 'Watson', 'operator': '<>'}
            };
            var strExpected = '[FirstName] = @FirstName AND [LastName] <> @LastName';
            expect(round.parseWhere(where)).toBe(strExpected);
        });

        it('it can retrieve parameters for a stored procedure.',function(done) {
            var strProcName = "[dbo].[A01_AccountMasterUpdate]";

            if(begun) {
                round.getStoredProcParameters(strProcName).then(function(rows) {
                    expect(rows[0].COLUMN_NAME).toBe('@SessionID');
                    expect(rows[1].COLUMN_NAME).toBe('@RecordID');
                    expect(rows[2].COLUMN_NAME).toBe('@AccountNumber');
                    done();
                },function(reason) {
                    console.log('DBERROR: ', reason);
                    done();
                });
            }
        });

        it('it can call the input method on a prepared statement given a where object.',function() {
            var where = {
                'FirstName': {'type': mssql.VarChar(20), 'value': 'Jonathan'}
                ,'LastName': {'type': mssql.VarChar(20), 'value': 'Watson'}
            };

            if(begun) {
                var ps = new mssql.PreparedStatement(transaction);

                spyOn(ps,'input').and.callThrough();

                round.setPreparedStatementInputs(ps,where);

                expect(ps.input).toHaveBeenCalledWith('FirstName',mssql.VarChar(20));
                expect(ps.input).toHaveBeenCalledWith('LastName',mssql.VarChar(20));
            }
        })

        it('it translates complex where objects to simpler ones for use with prepared statements.',function() {
            var where = {
                'FirstName': {'value': 'Jonathan'}
                ,'LastName': {'value': 'Watson'}
            };

            var expectedW = {'FirstName':'Jonathan','LastName':'Watson'};

            var w = round.getWhereForPreparedStatement(where);

            expect(w).toEqual(expectedW);
        });

        it('it executes simple queries well.',function(done) {
            var strSql = "SELECT TOP 1 * FROM A01_AccountMaster";

            if(begun) {
                round.query(strSql).then(function(recordset) {
                    expect(recordset[0].FirstName).toBe('Manfh');
                    done();
                },function(reason) {
                    console.log('DBERROR: ' , reason);
                    done();
                });
            }
        });

        it('it knows how to get column data for a table.',function(done) {
            if(begun) {
                round.getColumns('A01_AccountMaster').then(function(results) {
                    expect(results[0].COLUMN_NAME).toBe('RecordId');
                    expect(results[1].COLUMN_NAME).toBe('AccountNumber');
                    expect(results[2].COLUMN_NAME).toBe('FamilyId');
                    expect(results[3].COLUMN_NAME).toBe('AccountType');
                    done();
                },function(reason) {
                    console.log('DBERROR: ' , reason);
                    done();
                });
            }
        });

        it('it knows how to translate columns into a simpler format',function() {
            var columns = [ { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'RecordId', ORDINAL_POSITION: 1, COLUMN_DEFAULT: null, IS_NULLABLE: 'NO', DATA_TYPE: 'bigint', CHARACTER_MAXIMUM_LENGTH: null, CHARACTER_OCTET_LENGTH: null, NUMERIC_PRECISION: 19, NUMERIC_PRECISION_RADIX: 10, NUMERIC_SCALE: 0, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: null, COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: null, DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: 'PRIMARY KEY' }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'AccountNumber', ORDINAL_POSITION: 2, COLUMN_DEFAULT: null, IS_NULLABLE: 'NO', DATA_TYPE: 'bigint', CHARACTER_MAXIMUM_LENGTH: null, CHARACTER_OCTET_LENGTH: null, NUMERIC_PRECISION: 19, NUMERIC_PRECISION_RADIX: 10, NUMERIC_SCALE: 0, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: null, COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: null, DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'FamilyId', ORDINAL_POSITION: 3, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'bigint', CHARACTER_MAXIMUM_LENGTH: null, CHARACTER_OCTET_LENGTH: null, NUMERIC_PRECISION: 19, NUMERIC_PRECISION_RADIX: 10, NUMERIC_SCALE: 0, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: null, COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: null, DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'AccountType', ORDINAL_POSITION: 4, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 10, CHARACTER_OCTET_LENGTH: 10, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'FamilyMemberType', ORDINAL_POSITION: 5, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 10, CHARACTER_OCTET_LENGTH: 10, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'FamilyConsolidate', ORDINAL_POSITION: 6, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'bit', CHARACTER_MAXIMUM_LENGTH: null, CHARACTER_OCTET_LENGTH: null, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: null, COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: null, DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'AllowTransactions', ORDINAL_POSITION: 7, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'bit', CHARACTER_MAXIMUM_LENGTH: null, CHARACTER_OCTET_LENGTH: null, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: null, COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: null, DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'Title', ORDINAL_POSITION: 8, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 20, CHARACTER_OCTET_LENGTH: 20, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'FirstName', ORDINAL_POSITION: 9, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 20, CHARACTER_OCTET_LENGTH: 20, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'MiddleName', ORDINAL_POSITION: 10, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 20, CHARACTER_OCTET_LENGTH: 20, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'LastName', ORDINAL_POSITION: 11, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 20, CHARACTER_OCTET_LENGTH: 20, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'Suffix', ORDINAL_POSITION: 12, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 20, CHARACTER_OCTET_LENGTH: 20, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'OrganizationName', ORDINAL_POSITION: 13, COLUMN_DEFAULT: null, IS_NULLABLE: 'YES', DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 70, CHARACTER_OCTET_LENGTH: 70, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null }, { TABLE_CATALOG: 'DS_TEST', TABLE_SCHEMA: 'dbo', TABLE_NAME: 'A01_AccountMaster', COLUMN_NAME: 'Status', ORDINAL_POSITION: 14, COLUMN_DEFAULT: '(\'A\')', IS_NULLABLE: 'NO', DATA_TYPE: 'char', CHARACTER_MAXIMUM_LENGTH: 1, CHARACTER_OCTET_LENGTH: 1, NUMERIC_PRECISION: null, NUMERIC_PRECISION_RADIX: null, NUMERIC_SCALE: null, DATETIME_PRECISION: null, CHARACTER_SET_CATALOG: null, CHARACTER_SET_SCHEMA: null, CHARACTER_SET_NAME: 'iso_1', COLLATION_CATALOG: null, COLLATION_SCHEMA: null, COLLATION_NAME: 'SQL_Latin1_General_CP1_CI_AS', DOMAIN_CATALOG: null, DOMAIN_SCHEMA: null, DOMAIN_NAME: null, CONSTRAINT_TYPE: null } ];
            var translatedColumns = round.translateColumns(columns);
            expect(Object.keys(translatedColumns).length).toBe(14);
            expect(translatedColumns.FirstName.type).toEqual(mssql.VarChar(20));
        });

        it('it knows how to generate a model.',function(done) {
            if(begun) {
                round.getColumns('A01_AccountMaster').then(function(columns) {
                    var translatedColumns = round.translateColumns(columns);
                    var r = round.generateModel('A01_AccountMaster','Responder', translatedColumns);
                    expect(Object.keys(r).length).toBe(22);
                    expect(r.primaryKey).toBe('RecordId');
                    done();
                },function(reason) {
                    console.log('DBERROR: ', reason);
                    done();
                });
            }
        });

        it('it knows how to discover a model.',function(done) {
            if(begun) {
                round.discoverModel('A01_AccountMaster','Responder').then(function(models) {
                    expect(Object.keys(models.Responder).length).toEqual(22);
                    expect(models.Responder.primaryKey).toBe('RecordId');
                    done();
                },function(reason) {
                    console.log('DBERROR: ' , reason);
                    done();
                });
            }
        });

        it('once discovered, a model knows how to construct an insert query to save a model.',function(done) {
            if(begun) {
                round.discoverModel('A01_AccountMaster','Responder').then(function(models) {
                    models.Responder.findAll().then(function(results) {
                        var r1 = results[0];
                        expect(r1.getInsertQuery()).toBe("INSERT INTO [A01_AccountMaster] ([AccountNumber],[FamilyId],[AccountType],[FamilyMemberType],[FamilyConsolidate],[AllowTransactions],[Title],[FirstName],[MiddleName],[LastName],[Suffix],[OrganizationName],[Status]) VALUES (@AccountNumber, @FamilyId, @AccountType, @FamilyMemberType, @FamilyConsolidate, @AllowTransactions, @Title, @FirstName, @MiddleName, @LastName, @Suffix, @OrganizationName, @Status);\nSELECT SCOPE_IDENTITY() AS RecordId;\n");
                        var expectedParams = '{"AccountNumber":{"value":"40872580"},"FamilyId":{"value":"0"},"AccountType":{"value":"I","type":{"length":10}},"FamilyMemberType":{"value":"","type":{"length":10}},"FamilyConsolidate":{"value":true},"AllowTransactions":{"value":true},"Title":{"value":"","type":{"length":20}},"FirstName":{"value":"Manfh","type":{"length":20}},"MiddleName":{"value":"","type":{"length":20}},"LastName":{"value":"Babladi","type":{"length":20}},"Suffix":{"value":"","type":{"length":20}},"OrganizationName":{"value":"","type":{"length":70}},"Status":{"value":"A","type":{"length":1}}}';
                        var actualParams = r1.getInsertUpdateParams();
                        var actualStringParams = JSON.stringify(actualParams);
                        expect(actualStringParams).toBe(expectedParams);
                        done();
                    },function(reason) {
                        console.log(reason);
                        done();
                    });
                },function(reason) {
                    console.log('DBERROR: ' , reason);
                    done();
                });
            }
        });

        it('once discovered, a model knows how to construct an update query to save a model.',function(done) {
            if(begun) {
                round.discoverModel('A01_AccountMaster','Responder').then(function(models) {
                    models.Responder.findAll().then(function(results) {
                        var r1 = results[0];
                        expect(r1.getUpdateQuery()).toBe('UPDATE [A01_AccountMaster] SET [AccountNumber] = @AccountNumber, [FamilyId] = @FamilyId, [AccountType] = @AccountType, [FamilyMemberType] = @FamilyMemberType, [FamilyConsolidate] = @FamilyConsolidate, [AllowTransactions] = @AllowTransactions, [Title] = @Title, [FirstName] = @FirstName, [MiddleName] = @MiddleName, [LastName] = @LastName, [Suffix] = @Suffix, [OrganizationName] = @OrganizationName, [Status] = @Status WHERE [RecordId] = @RecordId');
                        var expectedParams = '{"AccountNumber":{"value":"40872580"},"FamilyId":{"value":"0"},"AccountType":{"value":"I","type":{"length":10}},"FamilyMemberType":{"value":"","type":{"length":10}},"FamilyConsolidate":{"value":true},"AllowTransactions":{"value":true},"Title":{"value":"","type":{"length":20}},"FirstName":{"value":"Manfh","type":{"length":20}},"MiddleName":{"value":"","type":{"length":20}},"LastName":{"value":"Babladi","type":{"length":20}},"Suffix":{"value":"","type":{"length":20}},"OrganizationName":{"value":"","type":{"length":70}},"Status":{"value":"A","type":{"length":1}},"RecordId":{"value":"1"}}';
                        var actualParams = r1.getInsertUpdateParams(true);
                        var actualStringParams = JSON.stringify(actualParams);
                        expect(actualStringParams).toBe(expectedParams);
                        done();
                    },function(reason) {
                        console.log(reason);
                        done();
                    });
                },function(reason) {
                    console.log('DBERROR: ' , reason);
                    done();
                });
            }
        });

        it('once discovered, a model knows how to delete a model.',function(done) {
            if(begun) {
                var doneError = ((done, reason) => {
                    console.log(reason);
                    done();
                }).bind(this, done);
                round.discoverModel('A01_AccountMaster','Responder').then(((done, doneError, models) => {
                    var r = models.Responder.new();
                    var strType = 'ACCTNBR';
                    var strSql = "DECLARE @iNextNumber bigint\n" +
                        "EXEC [dbo].[X31_NextNumberBusinessDataSingleValueByType] @strType=N'"+strType+"',@iNextNumber=@iNextNumber OUTPUT\n" +
                        "SELECT @INextNumber as N'NextNumber'";
                    round.query(strSql).then(((done, doneError, r, results) => {
                        var nextNumber = results[0].NextNumber;
                        r.AccountNumber = nextNumber;
                        r.FirstName = 'TESTJON';
                        r.LastName  = 'TESTWATSON';
                        r.AccountType = 'I';
                        r.FamilyConsolidate = 0;
                        r.AllowTransactions = 1;
                        r.Status = 'A';
                        r.save().then(((done, doneError, responder) => {
                            expect(responder.RecordId).toBeInteger();
                            responder.del().then(((done, doneError) =>{
                                expect(responder.RecordId).toBeNull();
                                done();
                            }).bind(this, done, doneError), doneError).catch(doneError);
                        }).bind(this, done, doneError), doneError).catch(doneError);
                    }).bind(this, done, doneError, r), doneError).catch(doneError);
                }).bind(this, done, doneError), doneError).catch(doneError);
            }
        });
    });

});
