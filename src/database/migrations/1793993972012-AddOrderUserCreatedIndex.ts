import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrderUserCreatedIndex1793993972012 implements MigrationInterface {
    name = 'AddOrderUserCreatedIndex1793993972012'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_62ed9830a417b14a54f485d63c" ON "order"  ("userId", "createdAt", "id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_62ed9830a417b14a54f485d63c"`);
    }

}
