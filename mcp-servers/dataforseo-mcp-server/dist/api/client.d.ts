import { AxiosInstance } from 'axios';
export interface DataForSeoClient {
    login: string;
    password: string;
    baseUrl: string;
    httpClient: AxiosInstance;
    get: <T>(url: string) => Promise<T>;
    post: <T>(url: string, data: any) => Promise<T>;
}
export declare function setupApiClient(login: string, password: string): DataForSeoClient;
