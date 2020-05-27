/**
 * Deep diff between two object, using lodash
 * @param  {Object} object Object compared
 * @param  {Object} base   Object to compare with
 * @return {Object}        Return a new object who represent the diff
 */
import _ from "lodash";

export function difference(object: any, base: any) {
  function changes(object: any, base: any) {
    return _.transform(object, function(result, value, key) {
      if (!_.isEqual(value, base[key])) {
        (result as any)[key] = (_.isObject(value) && _.isObject(base[key])) ? changes(value, base[key]) : value;
      }
    });
  }

  return changes(object, base);
}
