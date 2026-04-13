"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupApiClient = setupApiClient;
const axios_1 = __importDefault(require("axios"));
function setupApiClient(login, password) {
    const baseUrl = 'https://api.dataforseo.com/v3';
    // Create an Axios instance with authentication
    const httpClient = axios_1.default.create({
        baseURL: baseUrl,
        auth: {
            username: login,
            password: password
        },
        headers: {
            'Content-Type': 'application/json'
        }
    });
    // Create the client interface
    const client = {
        login,
        password,
        baseUrl,
        httpClient,
        async get(url) {
            try {
                const response = await httpClient.get(url);
                return response.data;
            }
            catch (error) {
                if (axios_1.default.isAxiosError(error)) {
                    console.error(`DataForSEO API GET error (${url}):`, error.response?.data || error.message);
                }
                else {
                    console.error(`DataForSEO API GET error (${url}):`, error);
                }
                throw error;
            }
        },
        async post(url, data) {
            try {
                const response = await httpClient.post(url, data);
                return response.data;
            }
            catch (error) {
                if (axios_1.default.isAxiosError(error)) {
                    console.error(`DataForSEO API POST error (${url}):`, error.response?.data || error.message);
                }
                else {
                    console.error(`DataForSEO API POST error (${url}):`, error);
                }
                throw error;
            }
        }
    };
    return client;
}
//# sourceMappingURL=client.js.map