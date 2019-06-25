const elasticsearch = require('elasticsearch');

const es = new elasticsearch.Client({
    host: '192.168.99.100:9200',
    log: 'trace'
});
