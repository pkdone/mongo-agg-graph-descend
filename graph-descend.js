/**
 * Generate an MongoDB Aggregation expression to descend through a document's nested fields
 * collecting each sub-document into a flattened array of elements in the result. Analogous to
 * MongoDB's $graphLookup Aggregation stage, but operating on each self-contained document in
 * isolation rather than linking different documents together. Aka. "flatten document". Most
 * parameters match the parameters for $graphLookup. Currently only supports MongoDB version 5+ due
 * to the use of the new $getField operator. However, for earlier versions of MongoDB you can
 * replace $getField in this function's code with @asya999's getField() function which performs the
 * equivalent, at: https://github.com/asya999/bits-n-pieces/blob/master/scripts/getField.js
 *
 * @param {String} [connectToField="children"] [OPTIONAL] The field in each sub-document which
 *                                             references an array of child sub-documents (if not
 *                                             specified, the functon will assume the child array 
 *                                             field at each level is called 'children')
 * @param {String} [startWith=null]            [OPTIONAL] The field at the top level of the
 *                                             document which references the first array of child
 *                                             sub-documents number (if not specified,
 *                                             connectToField will be used for the top level child
 *                                             array field)
 * @param {Number} [maxElements=25]            [OPTIONAL] The maximum number of sub-documents to
 *                                             flatten (the resulting aggregation expression issues
 *                                             a warning in the aggregation's output if this number
 *                                             isn't sufficient to allow a nested document to be
 *                                             fully descended
 * @param {Array} [omitFields=[]]              [OPTIONAL] The array of fields to omit from each
 *                                             flattened sub-document in the output array
 * @param {Number} [maxDepth=100]              [OPTIONAL] The maximum depth of documents to descend
 *                                             (this value is automatically limited by this
 *                                             function to a maximum of 100 because this is the
 *                                             maximum level of nesting supported by MongoDB for 
 *                                             BSON documents
 * @param {Boolean} [showSchema=false]         [OPTIONAL] Output the field types schema for each
 *                                             level traversed
 * @return {Object}                            The MongoDB Aggregation JSON expression object which
 *                                             can generate the flattened array for each document,
 *                                             containing nested sub-documents, flowing through an
 *                                             aggregation pipeline
 */
function graphDescend(connectToField="children", startWith=null, maxElements=25, omitFields=[], maxDepth=100, showSchema=false) {
  startWith = startWith ? startWith : connectToField;
  
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
                            // If showing schema is requried, show the captured schema for this level
                            {"$cond": [
                              showSchema,                          
                              [{"k": "schema", "v": {
                                "$map": {
                                  "input": {"$objectToArray": {"$getField": {"field": "subdoc", "input": "$$currLevelElement"}}},
                                  "as": "field",
                                  "in": {
                                    "fieldname": "$$field.k",
                                    "type": {"$type": "$$field.v"},          
                                  }
                                }
                              }}], 
                              [],
                            ]},                                                          
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

