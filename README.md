# roundsql

An easy-to-use model discovery and CRUD engine for MS SQL Server.

Uses on node-mssql. Offers a simple model discovery CRUD interface so you don't have to write SQL queries.

## Installation

    npm install roundsql

## Quick Example

```javascript
var mssql = require('mssql'); 
var roundsql = require('roundsql'); 

// Just give roundsql a transaction connection from mssql.

// ... set up mssql with configurations and a transaction.

transaction.begin().then(function() {
    var round = new roundsql(mssql,transaction);
    round.discoverModel('tablename','ModleName',{}).then(function(models) {
        var r = models.ModleName.new();
        models.ModleName.findAll({'id':{'value':13}}).then(function(results) {
            var r = results[0];
            r.ColumnName = 'New Value';
            r.save().then(function() {
                console.log("Model saved.");
            },function(reason) {
                console.log(reason.message);
            });
        },function(reason) {
            console.log(reason.message);
        });
    },function(reason) {
        console.log('ERROR: ' , reason);
        done();
    });
},function(reason) {
    console.log('ERROR: ' + reason.message);
});

```

## Documentation

No documentation yet. Sorry. I created this for me. Feel free to tinker / submit a pull request with documentation, etc. Thanks for your interest!

<a name="license" />
## License

Copyright (c) 2015 Jon Watson

The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
