export declare class VehicleDto {
    brand: string;
    model: string;
    color: string;
    plate: string;
}
export declare enum UserRole {
    PASAJERO = "pasajero",
    CONDUCTOR = "conductor"
}
export declare class RegisterDto {
    firstName: string;
    lastName: string;
    nationalId: string;
    email: string;
    password: string;
    role: UserRole;
    skipVehicle?: boolean;
    vehicle?: VehicleDto;
}
