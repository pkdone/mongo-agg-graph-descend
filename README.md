# mongo-agg-graph-descend

Provides a JavaScript function to generate a MongoDB Aggregation expression to descend through a document's nested fields collecting each sub-document into a flattened array of sub-documents in the result. Analogous to MongoDB's _$graphLookup_ aggregation stage, but operating on each self-contained document in isolation rather than linking different documents together. A.K.A. "flatten document". Most parameters match the parameters for _$graphLookup_. Currently only supports MongoDB version 5+ due to the use of the new _$getField_ operator. However, for earlier versions of MongoDB you can replace _$getField_ in this function's code with [@asya999](https://twitter.com/asya999)'s [getField() function](https://github.com/asya999/bits-n-pieces/blob/master/scripts/getField.js) which performs the equivalent.

For example, imagine there is a MongoDB collection containing documents similar to the following: 

```javascript
{
  elmntId: '0',
  val: 999,
  properties: [
    {
      elmntId: '0.0',
      val: 111,
      children: [
        { elmntId: '0.0.0', val: 123 },
        { elmntId: '0.0.1', val: 456, children: 5 },
        {
          elmntId: '0.0.2',
          val: 456,
          children: [
            { elmntId: '0.0.2.0', val: 333 },
            { elmntId: '0.0.2.1', val: 222, children: 'it' },
            { elmntId: '0.0.2.2', val: 111, children: [] }
          ]
        }
      ]
    },
    {
      elmntId: '0.1',
      val: 222,
      children: [
        { elmntId: '0.1.0', val: 789, children: { x: 1 } },
        { elmntId: '0.1.1', val: 120, children: [] },
        { elmntId: '0.1.2', val: 22, children: null }
      ]
    }
  ]
}
```

Executing an aggregation pipeline which performs a _$set/$addFields/$project_ operation using the expression generated by the _graphDescend()_ function will generate output documents similar to the one shown below.

```javascript
{result: [
  { _ord: 0, _depth: 0, _idx: '0', elmntId: '0', val: 999 },
  { _ord: 1, _depth: 1, _idx: '0_0', elmntId: '0.0', val: 111 },
  { _ord: 2, _depth: 1, _idx: '0_1', elmntId: '0.1', val: 222 },
  { _ord: 3, _depth: 2, _idx: '0_0_0', elmntId: '0.0.0', val: 123 },
  { _ord: 4, _depth: 2, _idx: '0_0_1', elmntId: '0.0.1', val: 456 },
  { _ord: 5, _depth: 2, _idx: '0_0_2', elmntId: '0.0.2', val: 456 },
  { _ord: 6, _depth: 2, _idx: '0_1_0', elmntId: '0.1.0', val: 789 },
  { _ord: 7, _depth: 2, _idx: '0_1_1', elmntId: '0.1.1', val: 120 },
  { _ord: 8, _depth: 2, _idx: '0_1_2', elmntId: '0.1.2', val: 22 },
  { _ord: 9, _depth: 3, _idx: '0_0_2_0', elmntId: '0.0.2.0', val: 333 },
  { _ord: 10, _depth: 3, _idx: '0_0_2_1', elmntId: '0.0.2.1', val: 222 },
  { _ord: 11, _depth: 3, _idx: '0_0_2_2', elmntId: '0.0.2.2', val: 111 }
]}
```

To test this function, use the MongoDB Shell to connect to an existing MongoDB database and run the following...


## Sample Data Population

Drop any old version of the database (if it exists) and then populate a new `persons` collection with 5 person documents:

```javascript
use mongo-agg-graph-descend-example;
db.dropDatabase();

db.mydata.insertMany([
  {
    "elmntId": "0",
    "val": 999,
    "properties": [
      {
        "elmntId": "0.0",
        "val": 111,
        "children": [
          {
            "elmntId": "0.0.0",
            "val": 123,
          },
          {
            "elmntId": "0.0.1",
            "val": 456,
            "children": 5,
          },
          {
            "elmntId": "0.0.2",
            "val": 456,
            "children": [
              {
                "elmntId": "0.0.2.0",
                "val": 333,
              },
              {
                "elmntId": "0.0.2.1",
                "val": 222,
                "children": "it",
              },
              {
                "elmntId": "0.0.2.2",
                "val": 111,
                "children": [],
              },
            ]
          },
        ]        
      },
      {
        "elmntId": "0.1",
        "val": 222,
        "children": [
          {
            "elmntId": "0.1.0",
            "val": 789,
            "children": {"x": 1},
          },
          {
            "elmntId": "0.1.1",
            "val": 120,
            "children": [],
          },
          {
            "elmntId": "0.1.2",
            "val": 22,
            "children": null,
          },
        ]        
      } 
    ]
  }
]);
```

## Define the 'graphDescend' Function

Define the graphDescend() function ready to be used by an aggregation pipeline:

```javascript
/**
 * Generate the MongoDB Aggregation expression to descend through a document's nested fields
 * collecting each sub-document into a flattened array of sub-documents in the result. Analogous to
 * MongoDB's $graphLookup Aggregation stage, but operating on each self-contained document in
 * isolation rather than linking different documents together. Aka. "flatten document". Most
 * parameters match the parameters for $graphLookup. Currently only supports MongoDB version 5+ due
 * to the use of the new $getField operator. However, for earlier versions of MongoDB you can
 * replace $getField in this function's code with @asya999's getField() function which performs the
 * equivalent, at: https://github.com/asya999/bits-n-pieces/blob/master/scripts/getField.js
 *
 * @param  {string} connectToField   The field in each sub-document which references an array of
                                     child sub-documents
 * @param  {string} [startWith=null] [OPTIONAL] The field at the top level of the document which
                                     references the first array of child sub-documents number (if
                                     not specified, connectToField will be used for the top level
                                     child array field)
 * @param  {Number} [maxElements=25] [OPTIONAL] The maximum number of sub-documents to flatten (the
                                     resulting aggregation expression issues a warning in the 
                                     aggregation's output if this number isn't sufficient to allow
                                     a nested document to be fully descended
 * @param  {Array} [omitFields=[]]   [OPTIONAL] The array of fields to omit from each flattened
                                     sub-document in the output array
 * @param  {Number} [maxDepth=100]   [OPTIONAL] The maximum depth of documents to descend (this 
                                     value is automatically limited by this function to a maximum
                                     of 100 because this is the maximum level of nesting supported
                                     by MongoDB for BSON documents
 * @return {string}                  The MongoDB Aggregation expression which generates the
                                     flattened array for each document, containing nested 
                                     sub-documents, flowing through an aggregation pipeline
 */
function graphDescend(connectToField, startWith=null, maxElements=25, omitFields=[], maxDepth=100) {
  return {
    "$let": {
      "vars": {
        // MongoDB supports "100 levels of nesting for BSON documents"
        "maxDepth": {"$cond": [{"$or": [{"$lt": [maxDepth, 0]}, {"$gt": [maxDepth, 100]}]}, 100, maxDepth]},
      },   
      "in": {
        "$reduce": {
          // Add buffer of 1 level to be able to optionally provide an 'overrun' warning in the result
          "input": {"$range": [0, {"$add": [maxElements, 1]}]},
          "initialValue": {
            // FINAL RESULT TO ACCUMULATE
            "result": [],        

            // LIST OF SUB-DOCS STILL TO-INSPECT
            "subLevelsToInspect": [{"_depth": 0, "_idx": "0", "subdoc": "$$ROOT"}],        
          },
          "in": {
          
            // START: result  (ADD LATEST SUB-DOC TO RESULTS)
            "result": {
              "$let": {
                "vars": { 
                  "currLevelElement": {"$first": "$$value.subLevelsToInspect"},
                  "currChildFieldName": {"$cond": [{"$lte": ["$$this", 0]}, startWith, connectToField]},                               
                },
                "in": {
                  "$concatArrays": [
                    "$$value.result",
                    {"$cond": [
                      // Stop accumulating array elements if we have now reached the end of list of nested sub-documents
                      {"$ifNull": ["$$currLevelElement", false]},
                      {"$cond": [                     
                        {"$gte": ["$$this", maxElements]},
                        [{"WARNING": "The 'maxElements' parameter for graphDescend() was not set to a large enough value to fully descend a nested document"}],
                        [{"$arrayToObject": [
                          {"$concatArrays": [
                            // Build next element in result array using the $graphDescend metadata + the sub-documents fields filtering out unwanted fields
                            [{"k": "_ord", "v": "$$this"}],
                            [{"k": "_depth", "v": {"$getField": {"field": "_depth", "input": "$$currLevelElement"}}}],
                            [{"k": "_idx", "v": {"$getField": {"field": "_idx", "input": "$$currLevelElement"}}}],
                            {"$map": {
                              "input": {
                                "$filter": { 
                                 "input": {"$objectToArray": {"$getField": {"field": "subdoc", "input": "$$currLevelElement"}}}, 
                                 "cond": {"$and": [
                                            {"$ne": ["$$this.k", "$$currChildFieldName"]},
                                            {"$not": {"$in": ["$$this.k", omitFields]}},
                                         ]}
                                }
                              },
                              "as": "element",
                              "in": {"k": "$$element.k", "v": "$$element.v"}
                            }},
                          ]}
                        ]}],                  
                      ]},                         
                      [], 
                    ]},                         
                  ]
                }
              }
            },
            // END: result 
            
            // START: subLevelsToInspect  (TRIM FIRST ELEMENT JUST INSPECTED AND ADD ANY DIRECT CHILDREN OF THIS ELEMENT TO THE LIST)
            "subLevelsToInspect": {
              "$let": {
                "vars": { 
                  "subLevelsToInspectSize": {"$size": "$$value.subLevelsToInspect"},
                  "currLevelChildren": {"$cond": [
                                         {"$lte": ["$$this", 0]},
                                         {"$getField": {"field": startWith, "input": {"$getField": {"field": "subdoc", "input": {"$first": "$$value.subLevelsToInspect"}}}}},
                                         {"$getField": {"field": connectToField, "input": {"$getField": {"field": "subdoc", "input": {"$first": "$$value.subLevelsToInspect"}}}}},
                                       ]},             
                  "currLevelIdx": {"$getField": {"field": "_idx", "input": {"$first": "$$value.subLevelsToInspect"}}},
                  "newDepthNumber": {"$add": [{"$getField": {"field": "_depth", "input": {"$first": "$$value.subLevelsToInspect"}}}, 1]},
                },
                "in": {
                  "$concatArrays": [
                    // Chop off first element in the list of sub-documents to inspect as this has just been processed
                    {"$cond": [
                      {"$gt": ["$$subLevelsToInspectSize", 0]},
                      {"$slice": ["$$value.subLevelsToInspect", 1, {"$add": ["$$subLevelsToInspectSize", 1]}]},
                      [],
                    ]},             
                    // Push each child array sub-document of current sub-document to the end of the list of sub-documents to inspect
                    {"$cond": [
                      {"$and": [{"$isArray": "$$currLevelChildren"}, {"$lte": ["$$newDepthNumber", "$$maxDepth"]}]},
                      {"$reduce": { 
                        "input": {"$range": [0, {"$size": "$$currLevelChildren"}]},
                        "initialValue": [],
                        "in": {
                          "$concatArrays": [                            
                            "$$value",
                            [{
                              // Add metadata to the element being added to the list
                              "_depth": "$$newDepthNumber",
                              "_idx": {"$concat": ["$$currLevelIdx", "_", {"$toString": "$$this"}]},
                              // Add the raw subdocument to the element being added to the list
                              "subdoc": {"$arrayElemAt": ["$$currLevelChildren", "$$this"]}
                            }],
                          ]
                        }
                      }},                  
                      [],
                    ]},             
                  ]            
                }
              }
            },   
            // END: subLevelsToInspect 
            
          }
        }
      }
    }
  };
}
```


## Aggregation Pipeline

Define a single pipeline ready to perform the aggregation:

```javascript
var pipeline = [
  {"$set": {
    "outputExample1": graphDescend("children", "properties"),
    "outputExample2": graphDescend("children", "properties", 5),
    "outputExample3": graphDescend("children", "properties", 25, ["_id", "val"]),
    "outputExample4": graphDescend("children", "properties", 25, [], 1),
  }},
];
```


## Execution

Execute the aggregation using the defined pipeline and also view its explain plan:

```javascript
db.mydata.aggregate(pipeline);
```

```javascript
db.mydata.explain("executionStats").aggregate(pipeline);
```

## TODOs
* Provide an example that works for MongoDB versions before 5.0
* Implement an optional parameter which is the equivalent of "restrictSearchWithMatch" used in _$graphLookup_


