// Subconjunto determinista de JSON Logic utilizado por los Knowledge Packs.
// No conoce ningún dominio jurídico: sólo evalúa datos estructurados.

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function truthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (value === 0 || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function getVar(data, path, fallback = null) {
  if (path === '' || path == null) return data;
  const parts = String(path).split('.');
  let current = data;
  for (const part of parts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) return fallback;
    current = current[part];
  }
  return current;
}

function argsOf(value, data) {
  return (Array.isArray(value) ? value : [value]).map((item) => evaluateJsonLogic(item, data));
}

export function evaluateJsonLogic(logic, data = {}) {
  if (Array.isArray(logic)) return logic.map((item) => evaluateJsonLogic(item, data));
  if (!isObject(logic)) return logic;

  const keys = Object.keys(logic);
  if (keys.length !== 1) {
    return Object.fromEntries(Object.entries(logic).map(([k, v]) => [k, evaluateJsonLogic(v, data)]));
  }
  const op = keys[0];
  const raw = logic[op];

  switch (op) {
    case 'var': {
      if (Array.isArray(raw)) return getVar(data, raw[0], raw.length > 1 ? raw[1] : null);
      return getVar(data, raw, null);
    }
    case '!': return !truthy(evaluateJsonLogic(raw, data));
    case 'and': {
      let last = null;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        last = evaluateJsonLogic(item, data);
        if (!truthy(last)) return last;
      }
      return last;
    }
    case 'or': {
      let last = null;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        last = evaluateJsonLogic(item, data);
        if (truthy(last)) return last;
      }
      return last;
    }
    case '==': {
      const [a,b] = argsOf(raw, data); return a == b; // JSON Logic usa igualdad laxa.
    }
    case '!=': {
      const [a,b] = argsOf(raw, data); return a != b;
    }
    case '>': {
      const v=argsOf(raw,data); return v.every((x,i)=>i===0 || v[i-1] > x);
    }
    case '>=': {
      const v=argsOf(raw,data); return v.every((x,i)=>i===0 || v[i-1] >= x);
    }
    case '<': {
      const v=argsOf(raw,data); return v.every((x,i)=>i===0 || v[i-1] < x);
    }
    case '<=': {
      const v=argsOf(raw,data); return v.every((x,i)=>i===0 || v[i-1] <= x);
    }
    case 'in': {
      const [needle, haystack] = argsOf(raw, data);
      if (Array.isArray(haystack)) return haystack.some((x) => x == needle);
      if (typeof haystack === 'string') return haystack.includes(String(needle));
      return false;
    }
    case '+': return argsOf(raw,data).reduce((sum,x)=>sum + Number(x || 0),0);
    case '-': {
      const v=argsOf(raw,data).map(Number);
      return v.length === 1 ? -v[0] : v.slice(1).reduce((x,y)=>x-y,v[0] || 0);
    }
    case '*': return argsOf(raw,data).reduce((product,x)=>product * Number(x),1);
    case '/': {
      const v=argsOf(raw,data).map(Number); return v.slice(1).reduce((x,y)=>x/y,v[0]);
    }
    case 'max': return Math.max(...argsOf(raw,data).map(Number));
    case 'min': return Math.min(...argsOf(raw,data).map(Number));
    case 'if': {
      const items=Array.isArray(raw)?raw:[raw];
      for(let i=0;i+1<items.length;i+=2){
        if(truthy(evaluateJsonLogic(items[i],data))) return evaluateJsonLogic(items[i+1],data);
      }
      return items.length%2 ? evaluateJsonLogic(items[items.length-1],data) : null;
    }
    case 'some': {
      const [listExpr, predicate] = Array.isArray(raw) ? raw : [];
      const list=evaluateJsonLogic(listExpr,data);
      return Array.isArray(list) && list.some((item)=>truthy(evaluateJsonLogic(predicate,item)));
    }
    case 'reduce': {
      const [listExpr, reducer, initial] = Array.isArray(raw) ? raw : [];
      const list=evaluateJsonLogic(listExpr,data);
      let acc=evaluateJsonLogic(initial,data);
      for(const current of Array.isArray(list)?list:[]){
        acc=evaluateJsonLogic(reducer,{ current, accumulator:acc });
      }
      return acc;
    }
    default:
      throw new Error(`JSON_LOGIC_OPERATOR_UNSUPPORTED:${op}`);
  }
}

export function jsonLogicTruthy(value) { return truthy(value); }
