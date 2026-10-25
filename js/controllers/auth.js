import { UserModel } from '../models/user.js';
import { AutomationModel } from '../models/automation.js';
import { Database } from '../db/database.js';

export class AuthController {
    static async login(email, password, remember) {
        const result = await UserModel.login(email, password, remember);
        if (result.success) {
            // Garante que o registro de estatísticas exista sem zerar dados anteriores do usuário
            const existingStats = await Database.get('user_stats', result.user.id);
            if (!existingStats) {
                await UserModel.updateStats(result.user.id, { gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 });
            }
            await AutomationModel.load(result.user.id);
            return { success: true, user: result.user, session: result.session };
        }
        return result;
    }

    static async register(name, email, password) {
        return await UserModel.register(name, email, password);
    }

    static async validateSession() {
        const result = await UserModel.validateSession();
        if (result) {
            await AutomationModel.load(result.user.id);
            return result;
        }
        return null;
    }

    static async logout(sessionId) {
        await UserModel.logout(sessionId);
    }

    static async changePassword(userId, currentPass, newPass) {
        return await UserModel.changePassword(userId, currentPass, newPass);
    }
}
