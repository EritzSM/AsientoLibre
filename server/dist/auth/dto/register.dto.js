var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength, ValidateNested, IsBoolean, } from 'class-validator';
import { Type } from 'class-transformer';
export class VehicleDto {
    brand;
    model;
    color;
    plate;
}
__decorate([
    IsString({ message: 'La marca del vehículo es requerida' }),
    IsNotEmpty({ message: 'La marca del vehículo no puede estar vacía' }),
    __metadata("design:type", String)
], VehicleDto.prototype, "brand", void 0);
__decorate([
    IsString({ message: 'El modelo del vehículo es requerido' }),
    IsNotEmpty({ message: 'El modelo del vehículo no puede estar vacío' }),
    __metadata("design:type", String)
], VehicleDto.prototype, "model", void 0);
__decorate([
    IsString({ message: 'El color del vehículo es requerido' }),
    IsNotEmpty({ message: 'El color del vehículo no puede estar vacío' }),
    __metadata("design:type", String)
], VehicleDto.prototype, "color", void 0);
__decorate([
    IsString({ message: 'La placa del vehículo es requerida' }),
    IsNotEmpty({ message: 'La placa del vehículo no puede estar vacía' }),
    __metadata("design:type", String)
], VehicleDto.prototype, "plate", void 0);
export var UserRole;
(function (UserRole) {
    UserRole["PASAJERO"] = "pasajero";
    UserRole["CONDUCTOR"] = "conductor";
})(UserRole || (UserRole = {}));
export class RegisterDto {
    firstName;
    lastName;
    nationalId;
    email;
    password;
    role;
    skipVehicle;
    vehicle;
}
__decorate([
    IsString({ message: 'El nombre debe ser una cadena de texto' }),
    IsNotEmpty({ message: 'El nombre es obligatorio' }),
    MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "firstName", void 0);
__decorate([
    IsString({ message: 'El apellido debe ser una cadena de texto' }),
    IsNotEmpty({ message: 'El apellido es obligatorio' }),
    MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "lastName", void 0);
__decorate([
    IsString({ message: 'El documento de identidad debe ser una cadena de texto' }),
    IsNotEmpty({ message: 'El documento de identidad es obligatorio' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "nationalId", void 0);
__decorate([
    IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' }),
    IsNotEmpty({ message: 'El correo electrónico es obligatorio' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "email", void 0);
__decorate([
    IsString({ message: 'La contraseña debe ser una cadena de texto' }),
    IsNotEmpty({ message: 'La contraseña es obligatoria' }),
    MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "password", void 0);
__decorate([
    IsEnum(UserRole, { message: 'El rol debe ser pasajero o conductor' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "role", void 0);
__decorate([
    IsOptional(),
    IsBoolean({ message: 'skipVehicle debe ser un valor booleano' }),
    __metadata("design:type", Boolean)
], RegisterDto.prototype, "skipVehicle", void 0);
__decorate([
    IsOptional(),
    ValidateNested(),
    Type(() => VehicleDto),
    __metadata("design:type", VehicleDto)
], RegisterDto.prototype, "vehicle", void 0);
//# sourceMappingURL=register.dto.js.map