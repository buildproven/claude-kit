"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiMethod = exports.StatusCode = void 0;
// Status codes and messages
var StatusCode;
(function (StatusCode) {
    StatusCode[StatusCode["SUCCESS"] = 20000] = "SUCCESS";
    StatusCode[StatusCode["TASK_CREATED"] = 20100] = "TASK_CREATED";
    StatusCode[StatusCode["NO_RESULTS"] = 20011] = "NO_RESULTS";
    StatusCode[StatusCode["ERROR"] = 40000] = "ERROR";
    StatusCode[StatusCode["AUTH_ERROR"] = 40100] = "AUTH_ERROR";
    StatusCode[StatusCode["INVALID_PARAMETERS"] = 40200] = "INVALID_PARAMETERS";
})(StatusCode || (exports.StatusCode = StatusCode = {}));
// API Methods
var ApiMethod;
(function (ApiMethod) {
    ApiMethod["TASK_POST"] = "task_post";
    ApiMethod["TASKS_READY"] = "tasks_ready";
    ApiMethod["TASK_GET"] = "task_get";
    ApiMethod["LIVE"] = "live";
})(ApiMethod || (exports.ApiMethod = ApiMethod = {}));
//# sourceMappingURL=types.js.map